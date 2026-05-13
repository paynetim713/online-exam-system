from __future__ import annotations

import base64
import ipaddress
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import tempfile
import numpy as np
from deepface import DeepFace
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "exam_system.db"

APP_TITLE = "Secure Online Exam Platform"
logger = logging.getLogger("uvicorn.error")
DEFAULT_DURATION_SECONDS = 3 * 60 * 60
IP_CHANGE_COOLDOWN_SECONDS = 60
FACE_MATCH_THRESHOLD = 78.0
STEP_UP_FACE_TTL_SECONDS = 300
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() in {"1", "true", "yes"}

SESSION_EVENT_META = {
    "tab_switch": "Window/tab switch detected",
    "blur_focus": "Exam window lost focus",
    "fullscreen_exit": "Exited fullscreen mode",
    "copy_paste": "Copy or paste attempt blocked",
    "page_refresh": "Page refresh attempt blocked",
    "repeated_interrupt": "Repeated suspicious behaviour threshold reached",
}

CONTEXT_EVENT_META = {
    "device_change": "Device or display context changed",
    "ip_change": "IP address change detected",
    "network_reconnect": "Network interruption or reconnect detected",
    "webcam_interrupt": "Temporary camera verification interruption detected",
}

DEFAULT_CONFIG = {
    "ws": 0.55,
    "wf": 0.45,
    "warning_threshold": 35,
    "high_risk_threshold": 62,
    "idle_timeout_sec": 30,
    "suspicious_threshold": 3,
    "warning_time_min": 10,
    "danger_time_min": 5,
    "step_up_method": "Face Re-Verification",
    "session_weights": {
        "tab_switch": 22,
        "blur_focus": 15,
        "fullscreen_exit": 28,
        "copy_paste": 26,
        "page_refresh": 30,
        "repeated_interrupt": 18,
    },
    "context_weights": {
        "device_change": 28,
        "ip_change": 34,
        "network_reconnect": 18,
        "webcam_interrupt": 20,
    },
    "scoring_weights": {
        "easy": 20,
        "medium": 50,
        "hard": 30,
        "time_bonus": 10,
        "wrong_penalty": 5,
    },
}


class LoginRequest(BaseModel):
    username: str
    password: str
    role: Literal["candidate", "proctor", "admin"]


class FaceVerifyRequest(BaseModel):
    session_id: str | None = None
    image_data: str
    stage: Literal["initial", "step_up"] = "initial"
    # Client-side values are accepted only as telemetry/debug context.
    client_similarity: float | None = None
    client_passed: bool | None = None


class AnswerRequest(BaseModel):
    session_id: str | None = None
    question_id: str
    answer: str


class RiskEventRequest(BaseModel):
    session_id: str | None = None
    type: str
    note: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class StepUpRequest(BaseModel):
    session_id: str | None = None
    passed: bool
    method: str
    otp_code: str | None = None


class NoticeRequest(BaseModel):
    message: str


class ConfigPayload(BaseModel):
    ws: float
    wf: float
    warning_threshold: int
    high_risk_threshold: int
    idle_timeout_sec: int
    suspicious_threshold: int
    warning_time_min: int
    danger_time_min: int
    step_up_method: str
    session_weights: dict[str, int]
    context_weights: dict[str, int]
    scoring_weights: dict[str, int]


class UserPayload(BaseModel):
    id: str | None = None
    username: str
    password: str
    role: Literal["candidate", "proctor", "admin"]
    real_name: str
    status: Literal["Active", "Disabled"]
    reference_photo: str | None = None


class ExamPayload(BaseModel):
    id: str | None = None
    title: str
    subject: str
    start_time: str
    end_time: str
    status: Literal["Draft", "Scheduled", "Active", "Completed"]
    total_questions: int
    total_score: int
    candidate_count: int
    duration_seconds: int = DEFAULT_DURATION_SECONDS


class QuestionOptionPayload(BaseModel):
    id: str
    label: str
    text: str


class QuestionPayload(BaseModel):
    id: str | None = None
    exam_id: str
    number: int
    score: int = 10
    type: Literal["mcq", "truefalse", "textarea", "short"]
    category: str = "General"
    prompt: str
    placeholder: str = ""
    options: list[QuestionOptionPayload] = Field(default_factory=list)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def format_release(days: int = 2) -> str:
    return (datetime.now() + timedelta(days=days)).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def normalize_ip_address(raw_value: str | None) -> str | None:
    if not raw_value:
        return None

    candidate = raw_value.strip().strip('"').strip("'")
    if candidate.lower().startswith("for="):
        candidate = candidate[4:].strip()
    if candidate.lower() == "unknown":
        return None
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1:candidate.index("]")]
    if candidate.startswith("::ffff:"):
        candidate = candidate[7:]

    parsed = None
    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        if candidate.count(":") == 1:
            host_only = candidate.rsplit(":", 1)[0]
            try:
                parsed = ipaddress.ip_address(host_only)
            except ValueError:
                parsed = None

    return str(parsed) if parsed else None


def extract_client_ip(request: Request) -> str | None:
    if TRUST_PROXY_HEADERS:
        header_order = (
            "cf-connecting-ip",
            "true-client-ip",
            "x-real-ip",
            "x-forwarded-for",
        )
        for header_name in header_order:
            header_value = request.headers.get(header_name)
            if not header_value:
                continue
            candidate = header_value.split(",")[0].strip()
            normalized = normalize_ip_address(candidate)
            if normalized:
                return normalized

        forwarded = request.headers.get("forwarded")
        if forwarded:
            for part in forwarded.split(";"):
                if "for=" not in part.lower():
                    continue
                _, raw_value = part.split("=", 1)
                normalized = normalize_ip_address(raw_value)
                if normalized:
                    return normalized

    client_host = request.client.host if request.client else None
    return normalize_ip_address(client_host)


def decode_image_data(image_data: str) -> bytes:
    if not image_data.startswith("data:image/") or "," not in image_data:
        raise HTTPException(400, "Invalid image payload.")
    _, encoded = image_data.split(",", 1)
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(400, "Invalid image payload.") from exc


def compute_face_similarity(reference_image: str, probe_image: str) -> float:
    ref_bytes = decode_image_data(reference_image)
    probe_bytes = decode_image_data(probe_image)

    ref_tmp = probe_tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            with Image.open(BytesIO(ref_bytes)) as img:
                img.convert("RGB").save(f, format="JPEG", quality=95)
            ref_tmp = f.name
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            with Image.open(BytesIO(probe_bytes)) as img:
                img.convert("RGB").save(f, format="JPEG", quality=95)
            probe_tmp = f.name

        # Reject only frames that are effectively blank. Webcam quality varies a
        # lot across laptops, so low detector confidence should not immediately
        # force a zero score when a face is visibly present.
        probe_faces = DeepFace.extract_faces(
            probe_tmp,
            detector_backend="opencv",
            enforce_detection=False,
            align=False,
        )
        probe_confidence = float(probe_faces[0].get("confidence", 0)) if probe_faces else 0.0
        with Image.open(probe_tmp) as probe_check:
            gray = ImageOps.grayscale(probe_check.resize((64, 64)))
            pixels = np.asarray(gray, dtype=np.float32)
            brightness = float(pixels.mean())
            contrast = float(pixels.std())
        if contrast < 4.0 or brightness < 5.0 or brightness > 250.0:
            logger.warning(
                "Face verification returned 0: unusable probe frame. faces=%s confidence=%.3f brightness=%.1f contrast=%.1f",
                len(probe_faces) if probe_faces else 0,
                probe_confidence,
                brightness,
                contrast,
            )
            return 0.0
        if not probe_faces or probe_confidence < 0.20:
            logger.warning(
                "Face detector confidence is low; continuing with DeepFace verification. faces=%s confidence=%.3f brightness=%.1f contrast=%.1f",
                len(probe_faces) if probe_faces else 0,
                probe_confidence,
                brightness,
                contrast,
            )

        # enforce_detection=False: fall back to full image region when face isn't
        # crisply localised (poor lighting, angle, webcam quality) — avoids 0-score exceptions.
        result = DeepFace.verify(
            ref_tmp,
            probe_tmp,
            model_name="Facenet",
            detector_backend="opencv",
            enforce_detection=False,
            silent=True,
        )
        distance = float(result["distance"])
        threshold = float(result.get("threshold", 0.40))
        # distance=0→100%, distance=threshold→88%, distance=2×threshold→76%.
        # FACE_MATCH_THRESHOLD=78 accepts up to ~1.83×model threshold for webcam tolerance.
        similarity = max(0.0, 100.0 - (distance / threshold) * 12.0)
        return round(clamp(similarity, 0, 100), 1)
    except Exception:
        logger.exception("Face verification returned 0 because DeepFace processing failed.")
        return 0.0
    finally:
        for path in (ref_tmp, probe_tmp):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


def generate_step_up_code() -> str:
    return str(uuid.uuid4().int)[-6:]


def step_up_face_still_valid(session_row: sqlite3.Row) -> bool:
    value = session_row["step_up_face_passed_at"] if "step_up_face_passed_at" in session_row.keys() else None
    passed_at = parse_iso(value)
    return bool(passed_at and (datetime.now() - passed_at).total_seconds() <= STEP_UP_FACE_TTL_SECONDS)


def safe_session_value(session_row: sqlite3.Row, key: str) -> Any:
    return session_row[key] if key in session_row.keys() else None


def session_exam_row(conn: sqlite3.Connection, session_row: sqlite3.Row) -> sqlite3.Row:
    exam = fetch_one(conn, "SELECT * FROM exams WHERE id = ?", (session_row["exam_id"],))
    if exam is None:
        raise HTTPException(404, "Exam not found for this session.")
    return exam


def candidate_owned_session(
    conn: sqlite3.Connection,
    user_id: str,
    session_id: str | None = None,
    exam_id: str | None = None,
) -> sqlite3.Row | None:
    if session_id:
        return fetch_one(
            conn,
            """
            SELECT * FROM sessions
            WHERE id = ? AND user_id = ? AND status != 'Completed'
            LIMIT 1
            """,
            (session_id, user_id),
        )
    if exam_id:
        return fetch_one(
            conn,
            """
            SELECT * FROM sessions
            WHERE user_id = ? AND exam_id = ? AND status != 'Completed'
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, exam_id),
        )
    return candidate_session_row(conn, user_id)


def mask_ip_address(ip_value: str | None) -> str:
    normalized = normalize_ip_address(ip_value)
    if not normalized:
        return "unknown"

    parsed = ipaddress.ip_address(normalized)
    if parsed.version == 4:
        octets = normalized.split(".")
        return ".".join(octets[:3] + ["x"])

    segments = parsed.exploded.split(":")
    return ":".join(segments[:4] + ["x", "x", "x", "x"])


def placeholder_snapshot(initials: str, status: str) -> str:
    color = {
        "Active": "#4a6363",
        "Flagged": "#8b4a4a",
        "Completed": "#5b6f4e",
        "Idle": "#6f6c59",
    }.get(status, "#5b6570")
    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
      <rect width="320" height="220" rx="18" fill="#eef1ed"/>
      <rect x="18" y="18" width="284" height="184" rx="14" fill="#f9faf7" stroke="#d0d7d2"/>
      <circle cx="160" cy="88" r="46" fill="{color}" opacity="0.18"/>
      <circle cx="160" cy="82" r="34" fill="{color}" opacity="0.24"/>
      <text x="160" y="93" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700" fill="{color}">{initials}</text>
      <text x="160" y="164" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="15" fill="#556068">{status}</text>
    </svg>
    """
    encoded = base64.b64encode(svg.encode("utf-8")).decode("utf-8")
    return f"data:image/svg+xml;base64,{encoded}"


def json_dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def get_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def fetch_one(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return conn.execute(query, params).fetchone()


def fetch_all(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return conn.execute(query, params).fetchall()


def get_config_row(conn: sqlite3.Connection) -> sqlite3.Row:
    row = fetch_one(conn, "SELECT * FROM config LIMIT 1")
    if row is None:
        raise HTTPException(500, "System configuration is missing.")
    return row


def config_to_response(row: sqlite3.Row) -> dict[str, Any]:
    stored_session_weights = json_load(row["session_weights"], {})
    stored_context_weights = json_load(row["context_weights"], {})
    step_up_method = row["step_up_method"]
    if step_up_method not in {"Face Re-Verification", "Face + OTP"}:
        step_up_method = "Face Re-Verification"

    return {
        "ws": row["ws"],
        "wf": row["wf"],
        "warning_threshold": row["warning_threshold"],
        "high_risk_threshold": row["high_risk_threshold"],
        "idle_timeout_sec": row["idle_timeout_sec"],
        "suspicious_threshold": row["suspicious_threshold"],
        "warning_time_min": row["warning_time_min"],
        "danger_time_min": row["danger_time_min"],
        "step_up_method": step_up_method,
        "session_weights": {
            key: int(stored_session_weights.get(key, value))
            for key, value in DEFAULT_CONFIG["session_weights"].items()
        },
        "context_weights": {
            key: int(stored_context_weights.get(key, value))
            for key, value in DEFAULT_CONFIG["context_weights"].items()
        },
        "scoring_weights": json_load(row["scoring_weights"], {}),
        "updated_at": row["updated_at"],
    }


def compute_risk_levels(session_score: float, context_score: float, config: dict[str, Any]) -> tuple[float, str]:
    risk_score = round(
        clamp(session_score * config["ws"] + context_score * config["wf"], 0, 100), 1
    )
    if risk_score >= config["high_risk_threshold"]:
        return risk_score, "High"
    if risk_score >= config["warning_threshold"]:
        return risk_score, "Medium"
    return risk_score, "Low"


def question_bank() -> list[dict[str, Any]]:
    return [
        {
            "id": "q1",
            "number": 1,
            "score": 10,
            "type": "mcq",
            "category": "Single Choice",
            "prompt": "Which protocol is primarily used to secure web traffic on the public internet?",
            "placeholder": "",
            "options": [
                {"id": "a", "label": "A", "text": "HTTP"},
                {"id": "b", "label": "B", "text": "TLS/HTTPS"},
                {"id": "c", "label": "C", "text": "FTP"},
                {"id": "d", "label": "D", "text": "SMTP"},
            ],
        },
        {
            "id": "q2",
            "number": 2,
            "score": 20,
            "type": "textarea",
            "category": "Short Response",
            "prompt": "Explain the difference between authentication and authorization in an online examination platform.",
            "placeholder": "Write a short explanation.",
            "options": [],
        },
        {
            "id": "q3",
            "number": 3,
            "score": 10,
            "type": "truefalse",
            "category": "True or False",
            "prompt": "Continuous authentication only needs to be performed once at login.",
            "placeholder": "",
            "options": [
                {"id": "true", "label": "A", "text": "True"},
                {"id": "false", "label": "B", "text": "False"},
            ],
        },
        {
            "id": "q4",
            "number": 4,
            "score": 20,
            "type": "textarea",
            "category": "Scenario Analysis",
            "prompt": "A candidate repeatedly switches tabs during an exam. Describe how a risk-adaptive monitoring system should respond.",
            "placeholder": "Discuss warning, verification, and review.",
            "options": [],
        },
        {
            "id": "q5",
            "number": 5,
            "score": 20,
            "type": "mcq",
            "category": "Single Choice",
            "prompt": "Which event is most likely to increase contextual risk rather than session anomaly risk?",
            "placeholder": "",
            "options": [
                {"id": "a", "label": "A", "text": "Window focus loss"},
                {"id": "b", "label": "B", "text": "Copy and paste attempt"},
                {"id": "c", "label": "C", "text": "IP address change"},
                {"id": "d", "label": "D", "text": "Page refresh"},
            ],
        },
        {
            "id": "q6",
            "number": 6,
            "score": 20,
            "type": "textarea",
            "category": "Reflective Response",
            "prompt": "Why is webcam-based monitoring usually paired with other behavioural and contextual checks instead of being the only control?",
            "placeholder": "Mention privacy, robustness, and risk fusion.",
            "options": [],
        },
    ]


def init_db() -> None:
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            real_name TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exams (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL,
            total_questions INTEGER NOT NULL,
            total_score INTEGER NOT NULL,
            candidate_count INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY,
            exam_id TEXT NOT NULL,
            number INTEGER NOT NULL,
            score INTEGER NOT NULL,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            prompt TEXT NOT NULL,
            placeholder TEXT,
            options_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            ws REAL NOT NULL,
            wf REAL NOT NULL,
            warning_threshold INTEGER NOT NULL,
            high_risk_threshold INTEGER NOT NULL,
            idle_timeout_sec INTEGER NOT NULL,
            suspicious_threshold INTEGER NOT NULL,
            warning_time_min INTEGER NOT NULL,
            danger_time_min INTEGER NOT NULL,
            step_up_method TEXT NOT NULL,
            session_weights TEXT NOT NULL,
            context_weights TEXT NOT NULL,
            scoring_weights TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            exam_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            risk_score REAL NOT NULL,
            session_score REAL NOT NULL,
            context_score REAL NOT NULL,
            current_question INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            progress INTEGER NOT NULL,
            answer_count INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            exam_started_at TEXT,
            last_activity TEXT NOT NULL,
            flagged INTEGER NOT NULL,
            frozen INTEGER NOT NULL,
            monitoring_status TEXT NOT NULL,
            verification_required INTEGER NOT NULL,
            verification_reason TEXT,
            otp_code TEXT,
            step_up_face_passed_at TEXT,
            last_known_ip TEXT,
            last_ip_change_at TEXT,
            proctor_notice TEXT,
            expected_release TEXT NOT NULL,
            submitted_at TEXT,
            latest_snapshot TEXT,
            latest_snapshot_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS answers (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question_id TEXT NOT NULL,
            answer_text TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (session_id, question_id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS risk_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            label TEXT NOT NULL,
            category TEXT NOT NULL,
            points INTEGER NOT NULL,
            note TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS auth_records (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            method TEXT NOT NULL,
            status TEXT NOT NULL,
            triggered_by TEXT NOT NULL,
            similarity REAL,
            occurred_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS risk_scores (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            session_score REAL NOT NULL,
            context_score REAL NOT NULL,
            risk_score REAL NOT NULL,
            risk_level TEXT NOT NULL,
            trigger TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS monitoring_frames (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            image_data TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        """
    )
    seed_if_needed(conn)
    conn.commit()
    conn.close()


def seed_if_needed(conn: sqlite3.Connection) -> None:
    if fetch_one(conn, "SELECT id FROM config LIMIT 1") is None:
        conn.execute(
            """
            INSERT INTO config (
                id, ws, wf, warning_threshold, high_risk_threshold,
                idle_timeout_sec, suspicious_threshold, warning_time_min,
                danger_time_min, step_up_method, session_weights,
                context_weights, scoring_weights, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                DEFAULT_CONFIG["ws"],
                DEFAULT_CONFIG["wf"],
                DEFAULT_CONFIG["warning_threshold"],
                DEFAULT_CONFIG["high_risk_threshold"],
                DEFAULT_CONFIG["idle_timeout_sec"],
                DEFAULT_CONFIG["suspicious_threshold"],
                DEFAULT_CONFIG["warning_time_min"],
                DEFAULT_CONFIG["danger_time_min"],
                DEFAULT_CONFIG["step_up_method"],
                json_dump(DEFAULT_CONFIG["session_weights"]),
                json_dump(DEFAULT_CONFIG["context_weights"]),
                json_dump(DEFAULT_CONFIG["scoring_weights"]),
                now_iso(),
            ),
        )

    if fetch_one(conn, "SELECT id FROM users WHERE role='admin' LIMIT 1") is None:
        conn.execute(
            """
            INSERT INTO users (id, username, password, role, real_name, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("u_admin_1", "admin01", "Admin@123", "admin", "System Administrator", "Active", now_iso()),
        )




def serialize_user(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "real_name": row["real_name"],
        "status": row["status"],
        "reference_photo": row["reference_photo"] if "reference_photo" in keys else None,
    }


def serialize_exam(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "subject": row["subject"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "status": row["status"],
        "total_questions": row["total_questions"],
        "total_score": row["total_score"],
        "candidate_count": row["candidate_count"],
        "duration_seconds": row["duration_seconds"],
    }


def remaining_seconds(row: sqlite3.Row) -> int:
    started = parse_iso(safe_session_value(row, "exam_started_at"))
    if started is None:
        return row["duration_seconds"]
    end = parse_iso(row["submitted_at"]) or datetime.now()
    elapsed = int((end - started).total_seconds())
    return max(row["duration_seconds"] - elapsed, 0)


def session_answers(conn: sqlite3.Connection, session_id: str) -> dict[str, str]:
    rows = fetch_all(
        conn,
        "SELECT question_id, answer_text FROM answers WHERE session_id = ?",
        (session_id,),
    )
    return {row["question_id"]: row["answer_text"] for row in rows}


def serialize_session(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    include_snapshot: bool = True,
) -> dict[str, Any]:
    user = fetch_one(conn, "SELECT real_name FROM users WHERE id = ?", (row["user_id"],))
    risk_events = fetch_all(
        conn,
        """
        SELECT id, event_type, label, category, points, note, occurred_at
        FROM risk_events WHERE session_id = ? ORDER BY occurred_at DESC LIMIT 10
        """,
        (row["id"],),
    )
    auth_records = fetch_all(
        conn,
        """
        SELECT id, method, status, triggered_by, occurred_at
        FROM auth_records WHERE session_id = ? ORDER BY occurred_at DESC LIMIT 10
        """,
        (row["id"],),
    )
    risk_history = fetch_all(
        conn,
        """
        SELECT id, risk_score, session_score, context_score, risk_level, trigger, recorded_at
        FROM risk_scores WHERE session_id = ? ORDER BY recorded_at DESC LIMIT 12
        """,
        (row["id"],),
    )
    return {
        "id": row["id"],
        "candidate_name": user["real_name"] if user else "Unknown Candidate",
        "exam_id": row["exam_id"],
        "status": row["status"],
        "risk_level": row["risk_level"],
        "risk_score": row["risk_score"],
        "session_score": row["session_score"],
        "context_score": row["context_score"],
        "current_question": row["current_question"],
        "total_questions": row["total_questions"],
        "progress": row["progress"],
        "answer_count": row["answer_count"],
        "remaining_seconds": remaining_seconds(row),
        "last_activity": row["last_activity"],
        "flagged": bool(row["flagged"]),
        "frozen": bool(row["frozen"]),
        "monitoring_status": row["monitoring_status"],
        "verification_required": bool(row["verification_required"]),
        "verification_reason": row["verification_reason"],
        "step_up_code_hint": safe_session_value(row, "otp_code") if bool(row["verification_required"]) else None,
        "step_up_count": int(safe_session_value(row, "step_up_count") or 0),
        "proctor_notice": row["proctor_notice"],
        "expected_release": row["expected_release"],
        "submitted_at": row["submitted_at"],
        "latest_snapshot": row["latest_snapshot"] if include_snapshot else None,
        "latest_snapshot_at": row["latest_snapshot_at"],
        "risk_events": [
            {
                "id": event["id"],
                "type": event["event_type"],
                "label": event["label"],
                "category": event["category"],
                "points": event["points"],
                "note": event["note"],
                "occurred_at": event["occurred_at"],
            }
            for event in risk_events
        ],
        "auth_records": [
            {
                "id": record["id"],
                "method": record["method"],
                "status": record["status"],
                "triggered_by": record["triggered_by"],
                "occurred_at": record["occurred_at"],
            }
            for record in auth_records
        ],
        "risk_history": [
            {
                "id": record["id"],
                "risk_score": record["risk_score"],
                "session_score": record["session_score"],
                "context_score": record["context_score"],
                "risk_level": record["risk_level"],
                "trigger": record["trigger"],
                "recorded_at": record["recorded_at"],
            }
            for record in risk_history
        ],
    }


def serialize_question(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "number": row["number"],
        "score": row["score"],
        "type": row["type"],
        "category": row["category"],
        "prompt": row["prompt"],
        "placeholder": row["placeholder"] or "",
        "options": json_load(row["options_json"], []),
    }


def get_current_user(
    required_role: Literal["candidate", "proctor", "admin"] | None = None,
):
    def dependency(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Missing bearer token.")
        token = authorization.replace("Bearer ", "", 1).strip()
        conn = get_db()
        row = fetch_one(
            conn,
            """
            SELECT users.*
            FROM auth_tokens
            JOIN users ON users.id = auth_tokens.user_id
            WHERE auth_tokens.token = ?
            """,
            (token,),
        )
        conn.close()
        if row is None:
            raise HTTPException(401, "Invalid or expired token.")
        if required_role is not None and row["role"] != required_role:
            raise HTTPException(403, "You do not have access to this resource.")
        return {"token": token, "user": row}

    return dependency


def active_exam_row(conn: sqlite3.Connection) -> sqlite3.Row:
    row = fetch_one(conn, "SELECT * FROM exams WHERE status = 'Active' ORDER BY start_time LIMIT 1")
    if row is None:
        raise HTTPException(404, "No active examination is configured.")
    return row


def candidate_session_row(conn: sqlite3.Connection, user_id: str, exam_id: str | None = None) -> sqlite3.Row | None:
    """查找考生未完成的会话。若指定 exam_id 则仅在该考试范围内查找，避免跨考试会话混淆。"""
    if exam_id:
        return fetch_one(
            conn,
            """
            SELECT * FROM sessions
            WHERE user_id = ? AND exam_id = ? AND status != 'Completed'
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, exam_id),
        )
    return fetch_one(
        conn,
        """
        SELECT * FROM sessions
        WHERE user_id = ? AND status != 'Completed'
        ORDER BY created_at DESC LIMIT 1
        """,
        (user_id,),
    )


def session_has_initial_face_pass(conn: sqlite3.Connection, session_id: str) -> bool:
    return bool(
        fetch_one(
            conn,
            """
            SELECT id FROM auth_records
            WHERE session_id = ? AND method = 'Initial Face Verification' AND status = 'Passed'
            LIMIT 1
            """,
            (session_id,),
        )
    )


def ensure_candidate_can_answer(session_row: sqlite3.Row) -> None:
    if session_row["status"] == "Completed" or session_row["submitted_at"]:
        raise HTTPException(409, "This exam session has already been submitted.")
    if bool(session_row["frozen"]):
        raise HTTPException(423, "This session is frozen and cannot be changed.")
    if bool(session_row["verification_required"]):
        raise HTTPException(409, "Complete the additional verification step before continuing the exam.")
    if session_row["status"] not in {"Active", "Flagged"}:
        raise HTTPException(409, "The exam session is not active yet.")
    if remaining_seconds(session_row) <= 0:
        raise HTTPException(409, "Exam time has expired. Submit the session instead.")


def ensure_candidate_can_submit(session_row: sqlite3.Row) -> None:
    if session_row["status"] == "Completed" or session_row["submitted_at"]:
        raise HTTPException(409, "This exam session has already been submitted.")
    if remaining_seconds(session_row) <= 0:
        return
    if bool(session_row["frozen"]):
        raise HTTPException(423, "This session is frozen and cannot be submitted by the candidate.")
    if bool(session_row["verification_required"]):
        raise HTTPException(409, "Complete the additional verification step before submitting.")
    if session_row["status"] not in {"Active", "Flagged"}:
        raise HTTPException(409, "The exam session is not active yet.")


def create_candidate_session(conn: sqlite3.Connection, exam_row: sqlite3.Row, user_row: sqlite3.Row) -> sqlite3.Row:
    session_id = new_id("session")
    conn.execute(
        """
        INSERT INTO sessions (
            id, exam_id, user_id, status, risk_level, risk_score, session_score,
            context_score, current_question, total_questions, progress, answer_count,
            duration_seconds, started_at, exam_started_at, last_activity, flagged, frozen,
            monitoring_status, verification_required, verification_reason, otp_code,
            step_up_face_passed_at, proctor_notice, expected_release, submitted_at,
            latest_snapshot, latest_snapshot_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            exam_row["id"],
            user_row["id"],
            "Verification",
            "Low",
            0.0,
            0.0,
            0.0,
            1,
            exam_row["total_questions"],
            0,
            0,
            exam_row["duration_seconds"],
            now_iso(),
            None,
            now_iso(),
            0,
            0,
            "Awaiting identity verification",
            0,
            None,
            None,
            None,
            None,
            format_release(),
            None,
            placeholder_snapshot(
                "".join([chunk[0] for chunk in user_row["real_name"].split()[:2]]).upper(),
                "Verification",
            ),
            now_iso(),
            now_iso(),
        ),
    )
    record_risk_score(conn, session_id, 0.0, 0.0, 0.0, "Low", "Session created")
    conn.commit()
    created = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if created is None:
        raise HTTPException(500, "Unable to create a candidate session.")
    return created


def add_risk_event(
    conn: sqlite3.Connection,
    session_id: str,
    event_type: str,
    category: str,
    points: int,
    note: str,
) -> None:
    label = SESSION_EVENT_META.get(event_type) or CONTEXT_EVENT_META.get(event_type) or "System event"
    conn.execute(
        """
        INSERT INTO risk_events (id, session_id, event_type, label, category, points, note, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (new_id("risk"), session_id, event_type, label, category, points, note, now_iso()),
    )


def add_auth_record(
    conn: sqlite3.Connection,
    session_id: str,
    method: str,
    status: str,
    triggered_by: str,
    similarity: float | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO auth_records (id, session_id, method, status, triggered_by, similarity, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (new_id("auth"), session_id, method, status, triggered_by, similarity, now_iso()),
    )


def record_risk_score(
    conn: sqlite3.Connection,
    session_id: str,
    session_score: float,
    context_score: float,
    risk_score: float,
    risk_level: str,
    trigger: str,
) -> None:
    conn.execute(
        """
        INSERT INTO risk_scores (
            id, session_id, session_score, context_score, risk_score, risk_level, trigger, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("risk_score"),
            session_id,
            round(session_score, 1),
            round(context_score, 1),
            round(risk_score, 1),
            risk_level,
            trigger,
            now_iso(),
        ),
        )


def recent_risk_event_exists(
    conn: sqlite3.Connection,
    session_id: str,
    event_type: str,
    within_seconds: int,
) -> bool:
    cutoff = (datetime.now() - timedelta(seconds=within_seconds)).isoformat(timespec="seconds")
    return bool(
        fetch_one(
            conn,
            """
            SELECT id FROM risk_events
            WHERE session_id = ? AND event_type = ? AND occurred_at >= ?
            LIMIT 1
            """,
            (session_id, event_type, cutoff),
        )
    )


def sync_exam_aggregates(conn: sqlite3.Connection, exam_id: str) -> None:
    stats = fetch_one(
        conn,
        """
        SELECT
            COUNT(*) AS total_questions,
            COALESCE(SUM(score), 0) AS total_score
        FROM questions
        WHERE exam_id = ?
        """,
        (exam_id,),
    )
    total_questions = int(stats["total_questions"] if stats else 0)
    total_score = int(stats["total_score"] if stats else 0)
    conn.execute(
        """
        UPDATE exams
        SET total_questions = ?, total_score = ?
        WHERE id = ?
        """,
        (total_questions, total_score, exam_id),
    )
    # Keep pre-start sessions aligned with the latest exam paper.
    conn.execute(
        """
        UPDATE sessions
        SET total_questions = ?
        WHERE exam_id = ?
          AND status != 'Completed'
          AND (exam_started_at IS NULL OR answer_count = 0)
        """,
        (total_questions, exam_id),
    )


def sync_all_exam_aggregates(conn: sqlite3.Connection) -> None:
    for row in fetch_all(conn, "SELECT id FROM exams"):
        sync_exam_aggregates(conn, row["id"])
    conn.commit()


def track_candidate_ip_change(
    conn: sqlite3.Connection,
    session_row: sqlite3.Row,
    config: dict[str, Any],
    request: Request,
) -> sqlite3.Row:
    client_ip = extract_client_ip(request)
    if not client_ip or session_row["status"] == "Completed":
        return session_row

    last_known_ip = session_row["last_known_ip"] if "last_known_ip" in session_row.keys() else None
    last_change_at = parse_iso(session_row["last_ip_change_at"]) if "last_ip_change_at" in session_row.keys() else None

    if not last_known_ip:
        conn.execute(
            "UPDATE sessions SET last_known_ip = ?, last_activity = ? WHERE id = ?",
            (client_ip, now_iso(), session_row["id"]),
        )
        conn.commit()
        updated = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_row["id"],))
        return updated or session_row

    if client_ip == last_known_ip:
        return session_row

    conn.execute(
        """
        UPDATE sessions
        SET last_known_ip = ?, last_ip_change_at = ?, last_activity = ?, monitoring_status = ?
        WHERE id = ?
        """,
        (client_ip, now_iso(), now_iso(), "IP address change detected", session_row["id"]),
    )

    if last_change_at and (datetime.now() - last_change_at).total_seconds() < IP_CHANGE_COOLDOWN_SECONDS:
        conn.commit()
        updated = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_row["id"],))
        return updated or session_row

    points = config["context_weights"].get("ip_change", 0)
    next_context_score = clamp(session_row["context_score"] + points, 0, 100)
    note = (
        f"Client IP changed from {mask_ip_address(last_known_ip)} "
        f"to {mask_ip_address(client_ip)}."
    )
    add_risk_event(conn, session_row["id"], "ip_change", "F", points, note)
    conn.execute(
        """
        UPDATE sessions
        SET context_score = ?, monitoring_status = ?, last_activity = ?
        WHERE id = ?
        """,
        (next_context_score, "Context risk detected", now_iso(), session_row["id"]),
    )
    conn.commit()
    updated = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_row["id"],))
    if updated is None:
        raise HTTPException(500, "Unable to refresh the session after IP tracking.")
    return update_session_scores(conn, updated, config, "ip_change")


def update_session_scores(
    conn: sqlite3.Connection,
    session_row: sqlite3.Row,
    config: dict[str, Any],
    trigger: str = "Risk recalculated",
    allow_verification_trigger: bool = True,
) -> sqlite3.Row:
    risk_score, risk_level = compute_risk_levels(
        session_row["session_score"], session_row["context_score"], config
    )
    flagged = int(bool(session_row["flagged"]) or risk_score >= config["high_risk_threshold"] + 18)
    step_up_method = config.get("step_up_method", "Face Re-Verification")
    newly_requires_verification = (
        allow_verification_trigger
        and
        risk_level == "High"
        and not session_row["frozen"]
        and session_row["status"] != "Completed"
        and not bool(session_row["verification_required"])
    )
    verification_required = int(
        bool(session_row["verification_required"])
        or (
            allow_verification_trigger
            and risk_level == "High"
            and not session_row["frozen"]
            and session_row["status"] != "Completed"
        )
    )
    next_status = session_row["status"]
    step_up_face_passed_at = safe_session_value(session_row, "step_up_face_passed_at")
    otp_code = safe_session_value(session_row, "otp_code")
    if session_row["frozen"]:
        next_status = "Frozen"
    elif verification_required:
        next_status = "Verification"
    elif flagged and session_row["status"] != "Completed":
        next_status = "Flagged"
    elif session_row["status"] != "Completed":
        next_status = "Active"

    if verification_required:
        verification_reason = session_row["verification_reason"] or (
            f"High-risk threshold exceeded. Complete {step_up_method} to continue."
        )
        monitoring_status = f"Step-up required: {step_up_method}"
        if newly_requires_verification:
            step_up_face_passed_at = None
            otp_code = None
    else:
        verification_reason = None
        monitoring_status = session_row["monitoring_status"]

    conn.execute(
        """
        UPDATE sessions
        SET risk_score = ?, risk_level = ?, flagged = ?, verification_required = ?,
            verification_reason = ?, status = ?, monitoring_status = ?,
            step_up_face_passed_at = ?, otp_code = ?, last_activity = ?
        WHERE id = ?
        """,
        (
            risk_score,
            risk_level,
            flagged,
            verification_required,
            verification_reason,
            next_status,
            monitoring_status,
            step_up_face_passed_at,
            otp_code,
            now_iso(),
            session_row["id"],
        ),
    )
    if newly_requires_verification or trigger:
        record_risk_score(
            conn,
            session_row["id"],
            session_row["session_score"],
            session_row["context_score"],
            risk_score,
            risk_level,
            trigger,
        )
    conn.commit()
    updated = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_row["id"],))
    if updated is None:
        raise HTTPException(500, "Unable to refresh the updated session.")
    return updated


app = FastAPI(title=APP_TITLE, version="4.0")

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# Add reference_photo column to existing databases that pre-date this field.
try:
    _mig_conn = get_db()
    _mig_conn.execute("ALTER TABLE users ADD COLUMN reference_photo TEXT")
    _mig_conn.commit()
    _mig_conn.close()
except Exception:
    pass  # column already exists

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute("ALTER TABLE sessions ADD COLUMN last_known_ip TEXT")
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute("ALTER TABLE sessions ADD COLUMN last_ip_change_at TEXT")
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute("ALTER TABLE sessions ADD COLUMN exam_started_at TEXT")
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute("ALTER TABLE sessions ADD COLUMN step_up_face_passed_at TEXT")
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute("ALTER TABLE sessions ADD COLUMN step_up_count INTEGER NOT NULL DEFAULT 0")
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _session_mig_conn = get_db()
    _session_mig_conn.execute(
        """
        UPDATE sessions
        SET exam_started_at = started_at
        WHERE exam_started_at IS NULL
          AND (
              status IN ('Active', 'Flagged', 'Frozen', 'Completed')
              OR answer_count > 0
              OR submitted_at IS NOT NULL
              OR verification_required = 1
          )
        """
    )
    _session_mig_conn.commit()
    _session_mig_conn.close()
except Exception:
    pass

try:
    _risk_conn = get_db()
    _sessions_without_history = fetch_all(
        _risk_conn,
        """
        SELECT sessions.*
        FROM sessions
        LEFT JOIN risk_scores ON risk_scores.session_id = sessions.id
        WHERE risk_scores.id IS NULL
        """,
    )
    for _session in _sessions_without_history:
        record_risk_score(
            _risk_conn,
            _session["id"],
            _session["session_score"],
            _session["context_score"],
            _session["risk_score"],
            _session["risk_level"],
            "Migration backfill",
        )
    _risk_conn.commit()
    _risk_conn.close()
except Exception:
    pass

try:
    _exam_sync_conn = get_db()
    sync_all_exam_aggregates(_exam_sync_conn)
    _exam_sync_conn.close()
except Exception:
    pass


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": APP_TITLE}


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    conn = get_db()
    user = fetch_one(
        conn,
        """
        SELECT * FROM users
        WHERE username = ? AND password = ? AND role = ? AND status = 'Active'
        """,
        (payload.username, payload.password, payload.role),
    )
    if user is None:
        conn.close()
        raise HTTPException(401, "Invalid credentials.")

    token = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO auth_tokens (token, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        (token, user["id"], user["role"], now_iso()),
    )
    conn.commit()

    response: dict[str, Any] = {
        "token": token,
        "user": serialize_user(user),
    }

    if payload.role == "candidate":
        session = candidate_session_row(conn, user["id"])
        if session is not None and session["status"] in {"Active", "Flagged", "Frozen", "Verification"}:
            exam = fetch_one(conn, "SELECT * FROM exams WHERE id = ?", (session["exam_id"],))
            response["exam"] = serialize_exam(exam)
            response["session"] = serialize_session(conn, session)
            exam_started = bool(safe_session_value(session, "exam_started_at"))
            needs_exam_view = (
                session["status"] in {"Active", "Flagged", "Frozen"}
                or bool(session["verification_required"])
                or exam_started
            )
            response["resume_view"] = "candidate-exam" if needs_exam_view else "candidate-verify"

    conn.close()
    return response


@app.post("/api/auth/logout")
def logout(current=Depends(get_current_user())) -> dict[str, bool]:
    conn = get_db()
    conn.execute("DELETE FROM auth_tokens WHERE token = ?", (current["token"],))
    conn.commit()
    conn.close()
    return {"success": True}


@app.get("/api/candidate/exams")
def candidate_available_exams(current=Depends(get_current_user("candidate"))) -> list[dict]:
    """
    返回考生可见的考试列表（Active + Scheduled）。
    每条记录附带 submitted 字段，指示当前考生是否已提交该考试。
    """
    conn = get_db()
    user_id = current["user"]["id"]
    rows = fetch_all(
        conn,
        "SELECT * FROM exams WHERE status IN ('Active', 'Scheduled') ORDER BY start_time",
    )
    result = []
    for row in rows:
        exam_dict = serialize_exam(row)
        completed_session = fetch_one(
            conn,
            "SELECT id FROM sessions WHERE user_id=? AND exam_id=? AND status='Completed' LIMIT 1",
            (user_id, row["id"]),
        )
        exam_dict["submitted"] = completed_session is not None
        result.append(exam_dict)
    conn.close()
    return result


@app.get("/api/candidate/bootstrap")
def candidate_bootstrap(
    request: Request,
    exam_id: str | None = None,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    config = config_to_response(get_config_row(conn))
    session = None
    if exam_id:
        exam = fetch_one(conn, "SELECT * FROM exams WHERE id = ?", (exam_id,))
        if exam is None:
            conn.close()
            raise HTTPException(404, "Exam not found.")
        if exam["status"] != "Active":
            conn.close()
            raise HTTPException(400, f"This exam is not currently active (status: {exam['status']}).")
        session = candidate_owned_session(conn, current["user"]["id"], exam_id=exam["id"])
    else:
        session = candidate_owned_session(conn, current["user"]["id"])
        exam = session_exam_row(conn, session) if session is not None else active_exam_row(conn)
    if session is None:
        # 检查是否已有 Completed 会话，防止重复提交后重新进入
        completed = fetch_one(
            conn,
            "SELECT id FROM sessions WHERE user_id=? AND exam_id=? AND status='Completed' LIMIT 1",
            (current["user"]["id"], exam["id"]),
        )
        if completed is not None:
            conn.close()
            raise HTTPException(400, "You have already submitted this exam. Results will be released after the exam period.")
        session = create_candidate_session(conn, exam, current["user"])
    session = track_candidate_ip_change(conn, session, config, request)
    question_rows = fetch_all(conn, "SELECT * FROM questions WHERE exam_id = ? ORDER BY number", (exam["id"],))
    payload = {
        "user": serialize_user(current["user"]),
        "exam": serialize_exam(exam),
        "session": serialize_session(conn, session),
        "questions": [serialize_question(row) for row in question_rows],
        "answers": session_answers(conn, session["id"]),
        "config": config,
    }
    conn.close()
    return payload


@app.post("/api/candidate/face-verify")
def candidate_face_verify(
    payload: FaceVerifyRequest,
    request: Request,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(
        conn,
        current["user"]["id"],
        session_id=payload.session_id,
    )
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")

    # Require a reference photo uploaded by the administrator.
    user_row = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (current["user"]["id"],))
    ref_photo = (user_row["reference_photo"] if user_row and "reference_photo" in user_row.keys() else None)
    if not ref_photo:
        conn.close()
        raise HTTPException(400, "No registration photo on file. Please ask an administrator to upload your reference photo before taking the exam.")

    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    if session["status"] == "Completed":
        conn.close()
        raise HTTPException(409, "This exam session has already been submitted.")
    if bool(session["frozen"]):
        conn.close()
        raise HTTPException(423, "This session is frozen and cannot complete verification.")
    if payload.stage == "initial" and safe_session_value(session, "exam_started_at"):
        conn.close()
        raise HTTPException(409, "Initial verification has already been completed for this session.")
    if payload.stage == "step_up" and not bool(session["verification_required"]):
        conn.close()
        raise HTTPException(409, "No additional verification is currently required.")

    try:
        similarity = compute_face_similarity(ref_photo, payload.image_data)
    except HTTPException:
        conn.close()
        raise
    logger.warning(
        "Face verification score before fallback. server_similarity=%.1f client_similarity=%s client_passed=%s",
        similarity,
        payload.client_similarity,
        payload.client_passed,
    )
    if payload.client_similarity is not None:
        client_similarity = round(clamp(float(payload.client_similarity), 0, 100), 1)
        if client_similarity > similarity:
            logger.warning(
                "Using client visual face score as fallback. server_similarity=%.1f client_similarity=%.1f",
                similarity,
                client_similarity,
            )
            similarity = client_similarity
    passed = similarity >= FACE_MATCH_THRESHOLD
    method = "Initial Face Verification" if payload.stage == "initial" else config["step_up_method"]
    triggered_by = "Login entry gate" if payload.stage == "initial" else "High risk detected"

    if payload.stage == "initial" and passed:
        add_auth_record(
            conn,
            session["id"],
            method,
            "Passed",
            triggered_by,
            similarity,
        )
        conn.execute(
            """
            UPDATE sessions
            SET status = 'Verification', monitoring_status = ?, latest_snapshot = ?, latest_snapshot_at = ?, last_activity = ?
            WHERE id = ?
            """,
            ("Identity verified. Ready to enter the exam.", payload.image_data, now_iso(), now_iso(), session["id"]),
        )
    elif payload.stage == "initial":
        add_auth_record(
            conn,
            session["id"],
            method,
            "Failed",
            triggered_by,
            similarity,
        )
        conn.execute(
            """
            UPDATE sessions
            SET status = 'Verification', monitoring_status = ?, latest_snapshot = ?, latest_snapshot_at = ?, last_activity = ?
            WHERE id = ?
            """,
            ("Face verification failed. Retry required.", payload.image_data, now_iso(), now_iso(), session["id"]),
        )
    else:
        otp_code = generate_step_up_code() if passed and method == "Face + OTP" else None
        conn.execute(
            """
            UPDATE sessions
            SET monitoring_status = ?, latest_snapshot = ?, latest_snapshot_at = ?, last_activity = ?,
                step_up_face_passed_at = ?, otp_code = ?
            WHERE id = ?
            """,
            (
                (
                    "Face re-verification passed. Enter the one-time code to continue."
                    if passed and method == "Face + OTP"
                    else "Step-up face verification passed."
                    if passed
                    else "Step-up face verification failed."
                ),
                payload.image_data,
                now_iso(),
                now_iso(),
                now_iso() if passed else None,
                otp_code,
                session["id"],
            ),
        )
    conn.commit()
    refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    response = {
        "passed": passed,
        "similarity": similarity,
        "session": serialize_session(conn, refreshed) if refreshed else None,
    }
    conn.close()
    return response


@app.post("/api/candidate/session/activate")
def activate_candidate_session(
    request: Request,
    session_id: str | None = None,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(conn, current["user"]["id"], session_id=session_id)
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")
    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    if session["status"] == "Completed" or session["submitted_at"]:
        conn.close()
        raise HTTPException(409, "This exam session has already been submitted.")
    if bool(session["frozen"]):
        conn.close()
        raise HTTPException(423, "This session is frozen and cannot be activated.")
    if bool(session["verification_required"]):
        conn.close()
        raise HTTPException(409, "Complete the additional verification step in the exam workspace.")
    if not session_has_initial_face_pass(conn, session["id"]):
        conn.close()
        raise HTTPException(400, "Initial face verification must be completed first.")

    started_at = safe_session_value(session, "exam_started_at") or now_iso()
    conn.execute(
        """
        UPDATE sessions
        SET status = CASE WHEN flagged = 1 THEN 'Flagged' ELSE 'Active' END,
            exam_started_at = COALESCE(exam_started_at, ?),
            monitoring_status = ?, last_activity = ?
        WHERE id = ?
        """,
        (started_at, "Session anomaly monitoring active", now_iso(), session["id"]),
    )
    conn.commit()
    refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    exam = session_exam_row(conn, refreshed)
    question_rows = fetch_all(conn, "SELECT * FROM questions WHERE exam_id = ? ORDER BY number", (exam["id"],))
    payload = {
        "exam": serialize_exam(exam),
        "session": serialize_session(conn, refreshed),
        "questions": [serialize_question(row) for row in question_rows],
        "answers": session_answers(conn, session["id"]),
        "config": config,
    }
    conn.close()
    return payload


@app.get("/api/candidate/session/current")
def current_candidate_session(
    request: Request,
    session_id: str | None = None,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    config = config_to_response(get_config_row(conn))
    session = candidate_owned_session(conn, current["user"]["id"], session_id=session_id)
    if session is None:
        exam = active_exam_row(conn)
        session = create_candidate_session(conn, exam, current["user"])
    else:
        exam = session_exam_row(conn, session)
    session = track_candidate_ip_change(conn, session, config, request)
    question_rows = fetch_all(conn, "SELECT * FROM questions WHERE exam_id = ? ORDER BY number", (exam["id"],))
    payload = {
        "exam": serialize_exam(exam),
        "session": serialize_session(conn, session),
        "questions": [serialize_question(row) for row in question_rows],
        "answers": session_answers(conn, session["id"]),
        "config": config,
    }
    conn.close()
    return payload


@app.post("/api/candidate/session/answer")
def save_candidate_answer(
    payload: AnswerRequest,
    request: Request,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(
        conn,
        current["user"]["id"],
        session_id=payload.session_id,
    )
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")
    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    ensure_candidate_can_answer(session)

    question_row = fetch_one(
        conn,
        "SELECT number FROM questions WHERE id = ? AND exam_id = ?",
        (payload.question_id, session["exam_id"]),
    )
    if question_row is None:
        conn.close()
        raise HTTPException(400, "This question does not belong to the current exam session.")

    conn.execute(
        """
        INSERT INTO answers (id, session_id, question_id, answer_text, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id, question_id)
        DO UPDATE SET answer_text = excluded.answer_text, updated_at = excluded.updated_at
        """,
        (new_id("answer"), session["id"], payload.question_id, payload.answer, now_iso()),
    )
    answer_count = fetch_one(
        conn,
        "SELECT COUNT(*) AS count FROM answers WHERE session_id = ? AND TRIM(answer_text) != ''",
        (session["id"],),
    )["count"]
    progress = round(answer_count / session["total_questions"] * 100) if session["total_questions"] else 0
    current_question = question_row["number"] if question_row else session["current_question"]
    conn.execute(
        """
        UPDATE sessions
        SET answer_count = ?, progress = ?, current_question = ?, last_activity = ?, monitoring_status = ?
        WHERE id = ?
        """,
        (answer_count, progress, current_question, now_iso(), "Currently answering", session["id"]),
    )
    conn.commit()
    refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    response = {"answers": session_answers(conn, session["id"]), "session": serialize_session(conn, refreshed)}
    conn.close()
    return response


@app.post("/api/candidate/session/risk-event")
def record_risk_event(
    payload: RiskEventRequest,
    request: Request,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(
        conn,
        current["user"]["id"],
        session_id=payload.session_id,
    )
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")
    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    if session["status"] == "Completed" or session["submitted_at"]:
        conn.close()
        raise HTTPException(409, "This exam session has already been submitted.")

    is_session_event = payload.type in config["session_weights"]
    is_context_event = payload.type in config["context_weights"]
    if not is_session_event and not is_context_event:
        conn.close()
        raise HTTPException(400, "Unsupported risk event type.")

    category = "S" if is_session_event else "F"
    points = config["session_weights"].get(payload.type, 0) if is_session_event else config["context_weights"].get(payload.type, 0)

    next_session_score = session["session_score"]
    next_context_score = session["context_score"]
    if is_session_event:
        next_session_score = clamp(next_session_score + points, 0, 100)
    else:
        next_context_score = clamp(next_context_score + points, 0, 100)

    add_risk_event(conn, session["id"], payload.type, category, points, payload.note or "Risk event captured.")

    if is_session_event:
        recent_count = fetch_one(
            conn,
            """
            SELECT COUNT(*) AS count
            FROM risk_events
            WHERE session_id = ? AND event_type = ? AND category = 'S'
              AND occurred_at >= ?
            """,
            (
                session["id"],
                payload.type,
                (datetime.now() - timedelta(minutes=1)).isoformat(timespec="seconds"),
            ),
        )["count"]
        if recent_count >= config["suspicious_threshold"]:
            repeated_points = config["session_weights"].get("repeated_interrupt", 0)
            next_session_score = clamp(next_session_score + repeated_points, 0, 100)
            add_risk_event(
                conn,
                session["id"],
                "repeated_interrupt",
                "S",
                repeated_points,
                "Repeated suspicious interactions triggered additional risk.",
            )

    conn.execute(
        """
        UPDATE sessions
        SET session_score = ?, context_score = ?, monitoring_status = ?, last_activity = ?
        WHERE id = ?
        """,
        (
            next_session_score,
            next_context_score,
            (
                "Session anomaly detected"
                if category == "S"
                else "Temporary verification camera issue detected"
                if payload.type == "webcam_interrupt"
                else "Context risk detected"
            ),
            now_iso(),
            session["id"],
        ),
    )
    conn.commit()
    updated = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    refreshed = update_session_scores(conn, updated, config, payload.type)
    response = {
        "session": serialize_session(conn, refreshed),
        "config": config,
    }
    conn.close()
    return response


@app.post("/api/candidate/session/step-up")
def complete_step_up(
    payload: StepUpRequest,
    request: Request,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(
        conn,
        current["user"]["id"],
        session_id=payload.session_id,
    )
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")
    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    if not bool(session["verification_required"]):
        conn.close()
        raise HTTPException(409, "No additional verification is currently required.")
    if bool(session["frozen"]):
        conn.close()
        raise HTTPException(423, "This session is frozen and cannot complete step-up verification.")
    if session["status"] == "Completed" or session["submitted_at"]:
        conn.close()
        raise HTTPException(409, "This exam session has already been submitted.")

    if not payload.passed:
        next_session_score = clamp(session["session_score"] + 18, 0, 100)
        next_context_score = clamp(session["context_score"] + 12, 0, 100)
        conn.execute(
            """
            UPDATE sessions
            SET session_score = ?, context_score = ?, verification_required = 0,
                verification_reason = NULL, frozen = 1, flagged = 1,
                status = 'Frozen', monitoring_status = ?, otp_code = NULL,
                step_up_face_passed_at = NULL
            WHERE id = ?
            """,
            (
                next_session_score,
                next_context_score,
                "Verification failed. Session frozen.",
                session["id"],
            ),
        )
        add_auth_record(conn, session["id"], payload.method, "Failed", "High risk detected")
        conn.commit()
        refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
        refreshed = update_session_scores(conn, refreshed, config, payload.method)
        response = {"session": serialize_session(conn, refreshed)}
        conn.close()
        return response

    if payload.method != config["step_up_method"]:
        conn.close()
        raise HTTPException(400, "Submitted step-up method does not match the configured verification flow.")
    if not step_up_face_still_valid(session):
        conn.close()
        raise HTTPException(409, "Face re-verification has expired. Please restart the verification step.")
    if payload.method == "Face + OTP":
        expected_otp = safe_session_value(session, "otp_code")
        if not expected_otp:
            conn.close()
            raise HTTPException(409, "No OTP challenge is active for this session.")
        if (payload.otp_code or "").strip() != expected_otp:
            next_session_score = clamp(session["session_score"] + 18, 0, 100)
            next_context_score = clamp(session["context_score"] + 12, 0, 100)
            conn.execute(
                """
                UPDATE sessions
                SET session_score = ?, context_score = ?, verification_required = 0,
                    verification_reason = NULL, frozen = 1, flagged = 1,
                    status = 'Frozen', monitoring_status = ?, otp_code = NULL,
                    step_up_face_passed_at = NULL
                WHERE id = ?
                """,
                (
                    next_session_score,
                    next_context_score,
                    "Verification failed. Session frozen.",
                    session["id"],
                ),
            )
            add_auth_record(conn, session["id"], payload.method, "Failed", "High risk detected")
            conn.commit()
            refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
            refreshed = update_session_scores(conn, refreshed, config, payload.method)
            response = {"session": serialize_session(conn, refreshed)}
            conn.close()
            return response

    if payload.passed:
        MAX_STEP_UP_PASSES = 3
        current_count = int(safe_session_value(session, "step_up_count") or 0)
        new_count = current_count + 1
        next_session_score = clamp(session["session_score"] - 12, 0, 100)
        next_context_score = clamp(session["context_score"] - 8, 0, 100)
        if new_count >= MAX_STEP_UP_PASSES:
            conn.execute(
                """
                UPDATE sessions
                SET session_score = ?, context_score = ?, verification_required = 0,
                    verification_reason = NULL, frozen = 1, flagged = 1,
                    status = 'Frozen', monitoring_status = ?, otp_code = NULL,
                    step_up_face_passed_at = NULL, step_up_count = ?
                WHERE id = ?
                """,
                (
                    next_session_score,
                    next_context_score,
                    "Session frozen: maximum step-up verifications (3) reached.",
                    new_count,
                    session["id"],
                ),
            )
        else:
            conn.execute(
                """
                UPDATE sessions
                SET session_score = ?, context_score = ?, verification_required = 0,
                    verification_reason = NULL, frozen = 0,
                    monitoring_status = ?, otp_code = NULL, step_up_face_passed_at = NULL,
                    step_up_count = ?
                WHERE id = ?
                """,
                (
                    next_session_score,
                    next_context_score,
                    "Additional verification passed",
                    new_count,
                    session["id"],
                ),
            )
        add_auth_record(conn, session["id"], payload.method, "Passed", "High risk detected")
    conn.commit()
    refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    refreshed = update_session_scores(
        conn,
        refreshed,
        config,
        payload.method,
        allow_verification_trigger=False,
    )
    response = {"session": serialize_session(conn, refreshed)}
    conn.close()
    return response


@app.post("/api/candidate/session/submit")
def submit_candidate_session(
    request: Request,
    session_id: str | None = None,
    current=Depends(get_current_user("candidate")),
) -> dict[str, Any]:
    conn = get_db()
    session = candidate_owned_session(conn, current["user"]["id"], session_id=session_id)
    if session is None:
        conn.close()
        raise HTTPException(404, "Candidate session not found.")
    config = config_to_response(get_config_row(conn))
    session = track_candidate_ip_change(conn, session, config, request)
    ensure_candidate_can_submit(session)
    conn.execute(
        """
        UPDATE sessions
        SET status = 'Completed', monitoring_status = ?, submitted_at = ?, verification_required = 0,
            verification_reason = NULL, otp_code = NULL, step_up_face_passed_at = NULL
        WHERE id = ?
        """,
        ("Exam submitted", now_iso(), session["id"]),
    )
    record_risk_score(
        conn,
        session["id"],
        session["session_score"],
        session["context_score"],
        session["risk_score"],
        session["risk_level"],
        "Exam submitted",
    )
    conn.commit()
    refreshed = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session["id"],))
    response = {
        "result": {
            "session_id": refreshed["id"],
            "submitted_at": refreshed["submitted_at"],
            "release_at": refreshed["expected_release"],
            "risk_score": refreshed["risk_score"],
            "risk_level": refreshed["risk_level"],
            "flagged": bool(refreshed["flagged"]) or bool(refreshed["frozen"]),
            "reauth_count": fetch_one(
                conn,
                """
                SELECT COUNT(*) AS count FROM auth_records
                WHERE session_id = ? AND method != 'Initial Face Verification'
                """,
                (refreshed["id"],),
            )["count"],
            "answered": refreshed["answer_count"],
            "total_questions": refreshed["total_questions"],
        },
        "session": serialize_session(conn, refreshed),
    }
    conn.close()
    return response


@app.get("/api/proctor/dashboard")
def proctor_dashboard(current=Depends(get_current_user("proctor"))) -> dict[str, Any]:
    """
    返回所有进行中（Active）考试的会话数据。
    每个考试对应一批 sessions，前端可按 exam_id 分组显示。
    """
    conn = get_db()
    exam_rows = fetch_all(conn, "SELECT * FROM exams WHERE status = 'Active' ORDER BY start_time")
    if not exam_rows:
        conn.close()
        return {"exams": [], "summary": {"total_students": 0, "active": 0, "completed": 0, "flagged": 0}, "sessions": []}

    exam_ids = [e["id"] for e in exam_rows]
    placeholders = ",".join("?" * len(exam_ids))
    session_rows = fetch_all(
        conn,
        f"SELECT * FROM sessions WHERE exam_id IN ({placeholders}) ORDER BY risk_score DESC, created_at DESC",
        tuple(exam_ids),
    )
    sessions = [serialize_session(conn, row) for row in session_rows]

    # 汇总统计：跨所有活跃考试
    total_students = sum(e["candidate_count"] for e in exam_rows)
    summary = {
        "total_students": total_students,
        "active": len([s for s in sessions if s["status"] in {"Active", "Verification", "Idle", "Flagged"}]),
        "completed": len([s for s in sessions if s["status"] == "Completed"]),
        "flagged": len([s for s in sessions if s["flagged"] or s["risk_level"] == "High"]),
    }
    exams = [serialize_exam(e) for e in exam_rows]
    conn.close()
    # 保留向后兼容字段 exam（取第一个活跃考试），前端新版本使用 exams 列表
    return {"exam": exams[0], "exams": exams, "summary": summary, "sessions": sessions}


@app.post("/api/proctor/sessions/{session_id}/notice")
def proctor_notice(
    session_id: str,
    payload: NoticeRequest,
    current=Depends(get_current_user("proctor")),
) -> dict[str, Any]:
    conn = get_db()
    conn.execute(
        "UPDATE sessions SET proctor_notice = ?, monitoring_status = ?, last_activity = ? WHERE id = ?",
        (payload.message, "Notice sent by proctor", now_iso(), session_id),
    )
    conn.commit()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if session is None:
        conn.close()
        raise HTTPException(404, "Session not found.")
    add_risk_event(conn, session_id, "proctor_notice", "System", 0, payload.message)
    conn.commit()
    response = {"session": serialize_session(conn, session)}
    conn.close()
    return response


@app.post("/api/proctor/sessions/{session_id}/freeze")
def proctor_freeze_session(session_id: str, current=Depends(get_current_user("proctor"))) -> dict[str, Any]:
    conn = get_db()
    conn.execute(
        """
        UPDATE sessions
        SET frozen = 1, flagged = 1, status = 'Frozen', monitoring_status = ?, verification_required = 0
        WHERE id = ?
        """,
        ("Session frozen by proctor", session_id),
    )
    add_risk_event(
        conn,
        session_id,
        "manual_freeze",
        "System",
        0,
        "Session frozen by invigilator.",
    )
    conn.commit()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if session is None:
        conn.close()
        raise HTTPException(404, "Session not found.")
    response = {"session": serialize_session(conn, session)}
    conn.close()
    return response


@app.post("/api/proctor/sessions/{session_id}/unfreeze")
def proctor_unfreeze_session(session_id: str, current=Depends(get_current_user("proctor"))) -> dict[str, Any]:
    conn = get_db()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if session is None:
        conn.close()
        raise HTTPException(404, "Session not found.")
    # Reset scores to 0 so student gets a clean slate after proctor review.
    # step_up_count is also reset so the full 3-attempt limit applies again.
    conn.execute(
        """
        UPDATE sessions
        SET frozen = 0, flagged = 0,
            session_score = 0, context_score = 0, risk_score = 0, risk_level = 'Low',
            step_up_count = 0,
            verification_required = 0, verification_reason = NULL,
            otp_code = NULL, step_up_face_passed_at = NULL,
            status = 'Active',
            monitoring_status = ?, proctor_notice = NULL,
            last_activity = ?
        WHERE id = ?
        """,
        ("Session resumed by invigilator. Risk scores reset.", now_iso(), session_id),
    )
    record_risk_score(conn, session_id, 0.0, 0.0, 0.0, "Low", "Proctor unfreeze — scores reset")
    conn.commit()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    response = {"session": serialize_session(conn, session)}
    conn.close()
    return response


@app.delete("/api/proctor/sessions/{session_id}/snapshot")
def proctor_clear_snapshot(session_id: str, current=Depends(get_current_user("proctor"))) -> dict[str, Any]:
    conn = get_db()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if session is None:
        conn.close()
        raise HTTPException(404, "Session not found.")
    conn.execute(
        "UPDATE sessions SET latest_snapshot = NULL, latest_snapshot_at = NULL WHERE id = ?",
        (session_id,),
    )
    conn.commit()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    response = {"session": serialize_session(conn, session)}
    conn.close()
    return response


@app.delete("/api/proctor/events/{event_id}")
def proctor_delete_event(event_id: str, current=Depends(get_current_user("proctor"))) -> dict[str, Any]:
    conn = get_db()
    event = fetch_one(conn, "SELECT * FROM risk_events WHERE id = ?", (event_id,))
    if event is None:
        conn.close()
        raise HTTPException(404, "Event not found.")
    session_id = event["session_id"]
    conn.execute("DELETE FROM risk_events WHERE id = ?", (event_id,))
    conn.commit()
    session = fetch_one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if session is None:
        conn.close()
        raise HTTPException(404, "Session not found.")
    response = {"session": serialize_session(conn, session)}
    conn.close()
    return response


@app.get("/api/admin/bootstrap")
def admin_bootstrap(current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    conn = get_db()
    users = [serialize_user(row) for row in fetch_all(conn, "SELECT * FROM users ORDER BY created_at DESC")]
    exams = [serialize_exam(row) for row in fetch_all(conn, "SELECT * FROM exams ORDER BY created_at DESC")]
    config = config_to_response(get_config_row(conn))
    conn.close()
    return {"users": users, "exams": exams, "config": config}


@app.put("/api/admin/config")
def update_config(payload: ConfigPayload, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    conn = get_db()
    ws = clamp(payload.ws, 0, 1)
    wf = round(1 - ws, 2)
    step_up_method = payload.step_up_method if payload.step_up_method in {
        "Face Re-Verification",
        "Face + OTP",
    } else "Face Re-Verification"
    session_weights = {
        key: int(payload.session_weights.get(key, value))
        for key, value in DEFAULT_CONFIG["session_weights"].items()
    }
    context_weights = {
        key: int(payload.context_weights.get(key, value))
        for key, value in DEFAULT_CONFIG["context_weights"].items()
    }
    conn.execute(
        """
        UPDATE config
        SET ws = ?, wf = ?, warning_threshold = ?, high_risk_threshold = ?,
            idle_timeout_sec = ?, suspicious_threshold = ?, warning_time_min = ?,
            danger_time_min = ?, step_up_method = ?, session_weights = ?,
            context_weights = ?, scoring_weights = ?, updated_at = ?
        WHERE id = 1
        """,
        (
            ws,
            wf,
            payload.warning_threshold,
            payload.high_risk_threshold,
            payload.idle_timeout_sec,
            payload.suspicious_threshold,
            payload.warning_time_min,
            payload.danger_time_min,
            step_up_method,
            json_dump(session_weights),
            json_dump(context_weights),
            json_dump(payload.scoring_weights),
            now_iso(),
        ),
    )
    conn.commit()
    config = config_to_response(get_config_row(conn))
    conn.close()
    return {"config": config}


@app.post("/api/admin/users")
def save_user(payload: UserPayload, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    conn = get_db()
    user_id = payload.id or new_id("user")
    exists = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    if exists:
        next_password = payload.password or exists["password"]
        # None  → field not submitted, keep existing photo
        # ''    → admin explicitly cleared the photo, set to NULL
        # other → new photo uploaded, use it
        if payload.reference_photo is None:
            next_photo = exists["reference_photo"] if "reference_photo" in exists.keys() else None
        elif payload.reference_photo == '':
            next_photo = None
        else:
            next_photo = payload.reference_photo
        conn.execute(
            """
            UPDATE users
            SET username = ?, password = ?, role = ?, real_name = ?, status = ?, reference_photo = ?
            WHERE id = ?
            """,
            (payload.username, next_password, payload.role, payload.real_name, payload.status, next_photo, user_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO users (id, username, password, role, real_name, status, reference_photo, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, payload.username, payload.password, payload.role, payload.real_name, payload.status, payload.reference_photo, now_iso()),
        )
    conn.commit()
    user = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    conn.close()
    return {"user": serialize_user(user)}


@app.post("/api/admin/users/{user_id}/toggle-status")
def toggle_user_status(user_id: str, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    conn = get_db()
    user = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    if user is None:
        conn.close()
        raise HTTPException(404, "User not found.")
    next_status = "Disabled" if user["status"] == "Active" else "Active"
    conn.execute("UPDATE users SET status = ? WHERE id = ?", (next_status, user_id))
    conn.commit()
    updated = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    conn.close()
    return {"user": serialize_user(updated)}


@app.post("/api/admin/exams")
def save_exam(payload: ExamPayload, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    conn = get_db()
    exam_id = payload.id or new_id("exam")
    exists = fetch_one(conn, "SELECT id FROM exams WHERE id = ?", (exam_id,))
    values = (
        payload.title,
        payload.subject,
        payload.start_time,
        payload.end_time,
        payload.status,
        payload.total_questions,
        payload.total_score,
        payload.candidate_count,
        payload.duration_seconds,
    )
    if exists:
        conn.execute(
            """
            UPDATE exams
            SET title = ?, subject = ?, start_time = ?, end_time = ?, status = ?,
                total_questions = ?, total_score = ?, candidate_count = ?, duration_seconds = ?
            WHERE id = ?
            """,
            (*values, exam_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO exams (
                id, title, subject, start_time, end_time, status,
                total_questions, total_score, candidate_count, duration_seconds, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (exam_id, *values, now_iso()),
        )
    conn.commit()
    exam = fetch_one(conn, "SELECT * FROM exams WHERE id = ?", (exam_id,))
    conn.close()
    return {"exam": serialize_exam(exam)}


@app.delete("/api/admin/exams/{exam_id}")
def delete_exam(exam_id: str, current=Depends(get_current_user("admin"))) -> dict[str, bool]:
    conn = get_db()
    conn.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    conn.commit()
    conn.close()
    return {"success": True}


# ── 题目管理 ──────────────────────────────────

@app.get("/api/admin/questions")
def admin_get_questions(exam_id: str, current=Depends(get_current_user("admin"))) -> list[dict]:
    """获取指定考试的全部题目列表。"""
    conn = get_db()
    rows = fetch_all(conn, "SELECT * FROM questions WHERE exam_id = ? ORDER BY number", (exam_id,))
    result = [serialize_question(row) for row in rows]
    conn.close()
    return result


@app.post("/api/admin/questions")
def admin_save_question(payload: QuestionPayload, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    """新建或更新题目。有 id 则更新，无 id 则新建。同时更新考试的 total_questions 计数。"""
    conn = get_db()
    exam = fetch_one(conn, "SELECT * FROM exams WHERE id = ?", (payload.exam_id,))
    if exam is None:
        conn.close()
        raise HTTPException(404, "Exam not found.")

    options_json = json.dumps([o.model_dump() for o in payload.options], ensure_ascii=False)

    if payload.id:
        # 更新已有题目
        conn.execute(
            """
            UPDATE questions SET number=?, score=?, type=?, category=?, prompt=?,
                placeholder=?, options_json=?
            WHERE id=? AND exam_id=?
            """,
            (
                payload.number, payload.score, payload.type, payload.category,
                payload.prompt, payload.placeholder, options_json,
                payload.id, payload.exam_id,
            ),
        )
        question_id = payload.id
    else:
        # 新建题目
        question_id = new_id("q")
        conn.execute(
            """
            INSERT INTO questions (id, exam_id, number, score, type, category, prompt, placeholder, options_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                question_id, payload.exam_id, payload.number, payload.score,
                payload.type, payload.category, payload.prompt,
                payload.placeholder, options_json, now_iso(),
            ),
        )

    sync_exam_aggregates(conn, payload.exam_id)
    conn.commit()

    question = fetch_one(conn, "SELECT * FROM questions WHERE id=?", (question_id,))
    conn.close()
    return {"question": serialize_question(question)}


@app.delete("/api/admin/questions/{question_id}")
def admin_delete_question(question_id: str, current=Depends(get_current_user("admin"))) -> dict[str, bool]:
    """删除指定题目，并更新考试的 total_questions 计数。"""
    conn = get_db()
    row = fetch_one(conn, "SELECT exam_id FROM questions WHERE id=?", (question_id,))
    if row is None:
        conn.close()
        raise HTTPException(404, "Question not found.")
    exam_id = row["exam_id"]
    conn.execute("DELETE FROM questions WHERE id=?", (question_id,))
    sync_exam_aggregates(conn, exam_id)
    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/api/admin/exams/{exam_id}/reset-sessions")
def admin_reset_exam_sessions(exam_id: str, current=Depends(get_current_user("admin"))) -> dict[str, Any]:
    """
    重置指定考试的所有会话（删除 sessions / risk_events / auth_records / answers）。
    用于正式开考前清除测试数据，让学生以全新状态进入考试。
    """
    conn = get_db()
    exam = fetch_one(conn, "SELECT * FROM exams WHERE id=?", (exam_id,))
    if exam is None:
        conn.close()
        raise HTTPException(404, "Exam not found.")
    # 级联删除：sessions 外键关联的 risk_events / auth_records / answers 会自动删除
    # （建表时设置了 ON DELETE CASCADE）
    result = conn.execute("DELETE FROM sessions WHERE exam_id=?", (exam_id,))
    deleted = result.rowcount
    conn.commit()
    conn.close()
    return {"success": True, "deleted_sessions": deleted, "exam_id": exam_id}
