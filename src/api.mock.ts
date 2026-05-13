import type {
  AdminBootstrap,
  CandidateBootstrap,
  CandidateSession,
  ExamRecord,
  LoginResponse,
  ProctorDashboardData,
  QuestionRecord,
  RiskConfig,
  SubmitResult,
  UserRecord,
} from './types'

function delay<T>(value: T, ms = 420): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function nowIso() {
  return new Date().toISOString().slice(0, 19)
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString().slice(0, 19)
}

function createRiskHistory(
  entries: Array<{
    risk_score: number
    session_score: number
    context_score: number
    risk_level: CandidateSession['risk_level']
    trigger: string
    recorded_at: string
  }>,
): CandidateSession['risk_history'] {
  return entries.map((entry, index) => ({
    id: `rh_${index}_${entry.recorded_at.replaceAll(':', '').replaceAll('-', '')}`,
    ...entry,
  }))
}

const PLACEHOLDER_PHOTO =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjQwIiB2aWV3Qm94PSIwIDAgMzIwIDI0MCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyNDAiIGZpbGw9IiNlOGVjZjEiLz48Y2lyY2xlIGN4PSIxNjAiIGN5PSI5MCIgcj0iNTAiIGZpbGw9IiNiMGJlY2UiLz48ZWxsaXBzZSBjeD0iMTYwIiBjeT0iMjAwIiByeD0iODAiIHJ5PSI1MCIgZmlsbD0iI2IwYmVjZSIvPjx0ZXh0IHg9IjE2MCIgeT0iMjM1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzY3ODBhMCI+UmVnaXN0ZXJlZCBQaG90bzwvdGV4dD48L3N2Zz4='

const MOCK_SNAPSHOT =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjIwIiB2aWV3Qm94PSIwIDAgMzIwIDIyMCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyMjAiIGZpbGw9IiNlZWYxZWQiLz48Y2lyY2xlIGN4PSIxNjAiIGN5PSI4NSIgcj0iNDIiIGZpbGw9IiM0YTYzNjMiIG9wYWNpdHk9Ii4yIi8+PGNpcmNsZSBjeD0iMTYwIiBjeT0iODAiIHI9IjMyIiBmaWxsPSIjNGE2MzYzIiBvcGFjaXR5PSIuMyIvPjx0ZXh0IHg9IjE2MCIgeT0iOTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMjIiIGZpbGw9IiM0YTYzNjMiPkFaPC90ZXh0Pjx0ZXh0IHg9IjE2MCIgeT0iMTYyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNTU2MDY4Ij5BY3RpdmU8L3RleHQ+PC9zdmc+'

const MOCK_CONFIG: RiskConfig = {
  ws: 0.6,
  wf: 0.4,
  warning_threshold: 40,
  high_risk_threshold: 70,
  idle_timeout_sec: 120,
  suspicious_threshold: 3,
  warning_time_min: 15,
  danger_time_min: 5,
  step_up_method: 'Face Re-Verification',
  session_weights: {
    tab_switch: 12,
    blur_focus: 8,
    fullscreen_exit: 6,
    copy_paste: 14,
    page_refresh: 10,
    repeated_interrupt: 20,
  },
  context_weights: {
    ip_change: 18,
    device_change: 14,
    network_reconnect: 10,
    webcam_interrupt: 12,
  },
  scoring_weights: { base: 10, repeat_multiplier: 15, decay_rate: 5 },
  updated_at: '2025-04-01T09:00:00',
}

const MOCK_EXAM: ExamRecord = {
  id: 'exam_demo_001',
  title: 'Risk-Adaptive Authentication Final Assessment',
  subject: 'Computer Science',
  start_time: new Date(Date.now() - 20 * 60 * 1000).toISOString().slice(0, 16),
  end_time: new Date(Date.now() + 160 * 60 * 1000).toISOString().slice(0, 16),
  status: 'Active',
  total_questions: 6,
  total_score: 100,
  candidate_count: 5,
  duration_seconds: 3 * 60 * 60,
}

const MOCK_EXAM_2: ExamRecord = {
  id: 'exam_demo_002',
  title: 'Network Security Practice Quiz',
  subject: 'Information Security',
  start_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  end_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString().slice(0, 16),
  status: 'Scheduled',
  total_questions: 10,
  total_score: 100,
  candidate_count: 30,
  duration_seconds: 2 * 60 * 60,
}

const MOCK_QUESTIONS: (QuestionRecord & { exam_id: string })[] = [
  { id: 'q1', exam_id: 'exam_demo_001', number: 1, score: 10, type: 'short', category: 'Concept', prompt: 'What does RA-MFA stand for, and what problem does it address in online examination systems?', placeholder: 'State the full name and describe the core challenge it solves.', options: [] },
  { id: 'q2', exam_id: 'exam_demo_001', number: 2, score: 20, type: 'textarea', category: 'Analysis', prompt: 'Explain the difference between session-level behavioural risk (S) and contextual environmental risk (F) in the composite risk model R = ws*S + wf*F. Give one example of an event that contributes to each.', placeholder: 'Compare the two risk components and provide concrete examples.', options: [] },
  { id: 'q3', exam_id: 'exam_demo_001', number: 3, score: 15, type: 'mcq', category: 'Single Choice', prompt: 'Which of the following events would most directly increase the contextual risk score (F) rather than the session risk score (S)?', placeholder: '', options: [{ id: 'a', label: 'A', text: 'Candidate switches to another browser tab' }, { id: 'b', label: 'B', text: 'Copy-and-paste action is detected' }, { id: 'c', label: 'C', text: 'IP address changes mid-session' }, { id: 'd', label: 'D', text: 'Candidate exits fullscreen mode' }] },
  { id: 'q4', exam_id: 'exam_demo_001', number: 4, score: 15, type: 'mcq', category: 'Single Choice', prompt: 'In the RA-MFA follow-up verification flow, which condition most directly triggers a temporary Face Re-Verification checkpoint?', placeholder: '', options: [{ id: 'a', label: 'A', text: 'Any single tab-switch event' }, { id: 'b', label: 'B', text: 'Composite risk exceeds the high-risk threshold and the configured step-up method requires face re-verification' }, { id: 'c', label: 'C', text: 'The candidate has been idle for more than 60 seconds' }, { id: 'd', label: 'D', text: 'The proctor manually sends a warning notice' }] },
  { id: 'q5', exam_id: 'exam_demo_001', number: 5, score: 20, type: 'textarea', category: 'Design', prompt: 'A candidate\'s session is frozen after failing a high-risk face re-verification checkpoint. Describe the state transitions from Active to Frozen, and outline the steps the proctor must take to review and potentially restore the session.', placeholder: 'Describe session states and the proctor intervention process.', options: [] },
  { id: 'q6', exam_id: 'exam_demo_001', number: 6, score: 20, type: 'textarea', category: 'Evaluation', prompt: 'Why is combining session behaviour signals, contextual changes, and temporary step-up checks more robust than relying on one signal alone?', placeholder: 'Discuss privacy, robustness, and fusion benefits.', options: [] },
]

const CANDIDATE_USER: UserRecord = {
  id: 'user_cand001',
  username: 'cand001',
  role: 'candidate',
  real_name: 'Alice Zhang',
  status: 'Active',
  reference_photo: PLACEHOLDER_PHOTO,
}

const PROCTOR_USER: UserRecord = {
  id: 'user_proct01',
  username: 'proctor01',
  role: 'proctor',
  real_name: 'Dr. Wei Chen',
  status: 'Active',
  reference_photo: null,
}

const ADMIN_USER: UserRecord = {
  id: 'user_admin01',
  username: 'admin01',
  role: 'admin',
  real_name: 'System Admin',
  status: 'Active',
  reference_photo: null,
}

function sampleRiskHistory(
  entries: Array<{
    risk_score: number
    session_score: number
    context_score: number
    risk_level: CandidateSession['risk_level']
    trigger: string
    minutes_ago: number
  }>,
) {
  return createRiskHistory(
    entries.map((entry) => ({
      risk_score: entry.risk_score,
      session_score: entry.session_score,
      context_score: entry.context_score,
      risk_level: entry.risk_level,
      trigger: entry.trigger,
      recorded_at: minutesAgo(entry.minutes_ago),
    })),
  )
}

function buildSampleProctorSessions(): CandidateSession[] {
  return [
    {
      id: 'sess_p1',
      candidate_name: 'Alice Zhang',
      exam_id: 'exam_demo_001',
      status: 'Active',
      risk_level: 'Low',
      risk_score: 12,
      session_score: 10,
      context_score: 14,
      current_question: 3,
      total_questions: 6,
      progress: 50,
      answer_count: 3,
      remaining_seconds: 8400,
      last_activity: nowIso(),
      flagged: false,
      frozen: false,
      monitoring_status: 'Normal',
      verification_required: false,
      verification_reason: null,
      step_up_count: 0,
      proctor_notice: null,
      expected_release: '',
      submitted_at: null,
      latest_snapshot: MOCK_SNAPSHOT,
      latest_snapshot_at: nowIso(),
      risk_events: [
        { id: 're1', type: 'blur_focus', label: 'Window Focus Lost', category: 'S', points: 8, note: 'Exam window lost focus.', occurred_at: minutesAgo(5) },
      ],
      auth_records: [
        { id: 'ar1', method: 'Initial Face Verification', status: 'Passed', triggered_by: 'Login entry gate', occurred_at: minutesAgo(25) },
      ],
      risk_history: sampleRiskHistory([
        { risk_score: 4, session_score: 2, context_score: 6, risk_level: 'Low', trigger: 'Session created', minutes_ago: 35 },
        { risk_score: 8, session_score: 6, context_score: 10, risk_level: 'Low', trigger: 'blur_focus', minutes_ago: 12 },
        { risk_score: 12, session_score: 10, context_score: 14, risk_level: 'Low', trigger: 'Current seeded state', minutes_ago: 5 },
      ]),
    },
    {
      id: 'sess_p2',
      candidate_name: 'Bob Li',
      exam_id: 'exam_demo_001',
      status: 'Active',
      risk_level: 'Medium',
      risk_score: 48,
      session_score: 52,
      context_score: 40,
      current_question: 4,
      total_questions: 6,
      progress: 67,
      answer_count: 4,
      remaining_seconds: 7200,
      last_activity: nowIso(),
      flagged: false,
      frozen: false,
      monitoring_status: 'Elevated risk - monitoring closely',
      verification_required: false,
      verification_reason: null,
      step_up_count: 0,
      proctor_notice: 'Please stay focused on your exam window and continue independently.',
      expected_release: '',
      submitted_at: null,
      latest_snapshot: MOCK_SNAPSHOT,
      latest_snapshot_at: nowIso(),
      risk_events: [
        { id: 're2', type: 'tab_switch', label: 'Tab Switch Detected', category: 'S', points: 12, note: 'Candidate switched browser tab.', occurred_at: minutesAgo(12) },
        { id: 're3', type: 'copy_paste', label: 'Copy/Paste Blocked', category: 'S', points: 14, note: 'Copy action was blocked.', occurred_at: minutesAgo(8) },
      ],
      auth_records: [
        { id: 'ar2', method: 'Initial Face Verification', status: 'Passed', triggered_by: 'Login entry gate', occurred_at: minutesAgo(30) },
      ],
      risk_history: sampleRiskHistory([
        { risk_score: 18, session_score: 20, context_score: 16, risk_level: 'Low', trigger: 'Session created', minutes_ago: 40 },
        { risk_score: 34, session_score: 38, context_score: 24, risk_level: 'Low', trigger: 'tab_switch', minutes_ago: 16 },
        { risk_score: 48, session_score: 52, context_score: 40, risk_level: 'Medium', trigger: 'copy_paste', minutes_ago: 8 },
      ]),
    },
    {
      id: 'sess_p3',
      candidate_name: 'Carol Chen',
      exam_id: 'exam_demo_001',
      status: 'Frozen',
      risk_level: 'High',
      risk_score: 82,
      session_score: 88,
      context_score: 72,
      current_question: 2,
      total_questions: 6,
      progress: 33,
      answer_count: 2,
      remaining_seconds: 6000,
      last_activity: minutesAgo(10),
      flagged: true,
      frozen: true,
      monitoring_status: 'Session frozen - awaiting proctor review',
      verification_required: false,
      verification_reason: 'Face re-verification failed.',
      step_up_count: 3,
      proctor_notice: null,
      expected_release: '',
      submitted_at: null,
      latest_snapshot: MOCK_SNAPSHOT,
      latest_snapshot_at: minutesAgo(10),
      risk_events: [
        { id: 're4', type: 'tab_switch', label: 'Tab Switch Detected', category: 'S', points: 12, note: 'Candidate switched browser tab.', occurred_at: minutesAgo(20) },
        { id: 're5', type: 'copy_paste', label: 'Copy/Paste Blocked', category: 'S', points: 14, note: 'Paste action blocked.', occurred_at: minutesAgo(18) },
        { id: 're6', type: 'ip_change', label: 'IP Address Changed', category: 'F', points: 18, note: 'Network change detected.', occurred_at: minutesAgo(15) },
      ],
      auth_records: [
        { id: 'ar3', method: 'Initial Face Verification', status: 'Passed', triggered_by: 'Login entry gate', occurred_at: minutesAgo(40) },
        { id: 'ar4', method: 'Face Re-Verification', status: 'Failed', triggered_by: 'High risk detected', occurred_at: minutesAgo(10) },
      ],
      risk_history: sampleRiskHistory([
        { risk_score: 28, session_score: 30, context_score: 22, risk_level: 'Low', trigger: 'Session created', minutes_ago: 48 },
        { risk_score: 58, session_score: 64, context_score: 46, risk_level: 'Medium', trigger: 'ip_change', minutes_ago: 18 },
        { risk_score: 82, session_score: 88, context_score: 72, risk_level: 'High', trigger: 'Face Re-Verification', minutes_ago: 10 },
      ]),
    },
    {
      id: 'sess_p4',
      candidate_name: 'David Wang',
      exam_id: 'exam_demo_001',
      status: 'Completed',
      risk_level: 'Low',
      risk_score: 18,
      session_score: 15,
      context_score: 22,
      current_question: 6,
      total_questions: 6,
      progress: 100,
      answer_count: 6,
      remaining_seconds: 0,
      last_activity: minutesAgo(20),
      flagged: false,
      frozen: false,
      monitoring_status: 'Submitted',
      verification_required: false,
      verification_reason: null,
      step_up_count: 0,
      proctor_notice: null,
      expected_release: '',
      submitted_at: minutesAgo(20),
      latest_snapshot: MOCK_SNAPSHOT,
      latest_snapshot_at: minutesAgo(20),
      risk_events: [],
      auth_records: [
        { id: 'ar5', method: 'Initial Face Verification', status: 'Passed', triggered_by: 'Login entry gate', occurred_at: minutesAgo(90) },
      ],
      risk_history: sampleRiskHistory([
        { risk_score: 6, session_score: 6, context_score: 8, risk_level: 'Low', trigger: 'Session created', minutes_ago: 110 },
        { risk_score: 12, session_score: 10, context_score: 18, risk_level: 'Low', trigger: 'Candidate activity update', minutes_ago: 52 },
        { risk_score: 18, session_score: 15, context_score: 22, risk_level: 'Low', trigger: 'Exam submitted', minutes_ago: 20 },
      ]),
    },
    {
      id: 'sess_p5',
      candidate_name: 'Eva Liu',
      exam_id: 'exam_demo_001',
      status: 'Verification',
      risk_level: 'Medium',
      risk_score: 55,
      session_score: 60,
      context_score: 46,
      current_question: 5,
      total_questions: 6,
      progress: 83,
      answer_count: 5,
      remaining_seconds: 5400,
      last_activity: nowIso(),
      flagged: false,
      frozen: false,
      monitoring_status: 'Step-up verification in progress',
      verification_required: true,
      verification_reason: 'High risk threshold exceeded. Complete Face Re-Verification to continue.',
      step_up_count: 1,
      proctor_notice: null,
      expected_release: '',
      submitted_at: null,
      latest_snapshot: MOCK_SNAPSHOT,
      latest_snapshot_at: nowIso(),
      risk_events: [
        { id: 're7', type: 'fullscreen_exit', label: 'Fullscreen Exited', category: 'S', points: 6, note: 'Fullscreen mode was exited.', occurred_at: minutesAgo(3) },
      ],
      auth_records: [
        { id: 'ar6', method: 'Initial Face Verification', status: 'Passed', triggered_by: 'Login entry gate', occurred_at: minutesAgo(50) },
      ],
      risk_history: sampleRiskHistory([
        { risk_score: 22, session_score: 24, context_score: 18, risk_level: 'Low', trigger: 'Session created', minutes_ago: 44 },
        { risk_score: 40, session_score: 44, context_score: 32, risk_level: 'Medium', trigger: 'fullscreen_exit', minutes_ago: 9 },
        { risk_score: 55, session_score: 60, context_score: 46, risk_level: 'Medium', trigger: 'High-risk checkpoint pending', minutes_ago: 3 },
      ]),
    },
  ]
}

interface MockState {
  token: string | null
  role: string | null
  userId: string | null
  sessionId: string
  sessionActive: boolean
  sessionStatus: CandidateSession['status']
  verified: boolean
  riskScore: number
  sessionScore: number
  contextScore: number
  riskLevel: CandidateSession['risk_level']
  riskEvents: CandidateSession['risk_events']
  authRecords: CandidateSession['auth_records']
  riskHistory: CandidateSession['risk_history']
  answers: Record<string, string>
  remainingSeconds: number
  latestSnapshot: string | null
  stepUpCodeHint: string | null
  proctorNotice: string | null
  verificationRequired: boolean
  verificationReason: string | null
  frozen: boolean
  flagged: boolean
  users: UserRecord[]
  exams: ExamRecord[]
  config: RiskConfig
  questions: (QuestionRecord & { exam_id: string })[]
  proctorSessions: CandidateSession[]
}

const state: MockState = {
  token: null,
  role: null,
  userId: null,
  sessionId: 'sess_demo_cand',
  sessionActive: false,
  sessionStatus: 'Idle',
  verified: false,
  riskScore: 0,
  sessionScore: 0,
  contextScore: 0,
  riskLevel: 'Low',
  riskEvents: [],
  authRecords: [],
  riskHistory: sampleRiskHistory([
    { risk_score: 0, session_score: 0, context_score: 0, risk_level: 'Low', trigger: 'Session created', minutes_ago: 15 },
  ]),
  answers: {},
  remainingSeconds: 3 * 60 * 60,
  latestSnapshot: null,
  stepUpCodeHint: null,
  proctorNotice: null,
  verificationRequired: false,
  verificationReason: null,
  frozen: false,
  flagged: false,
  users: [CANDIDATE_USER, PROCTOR_USER, ADMIN_USER],
  exams: [MOCK_EXAM, MOCK_EXAM_2],
  config: MOCK_CONFIG,
  questions: [...MOCK_QUESTIONS],
  proctorSessions: buildSampleProctorSessions(),
}

function buildCandidateSession(): CandidateSession {
  return {
    id: state.sessionId,
    candidate_name: 'Alice Zhang',
    exam_id: 'exam_demo_001',
    status: state.sessionStatus,
    risk_level: state.riskLevel,
    risk_score: state.riskScore,
    session_score: state.sessionScore,
    context_score: state.contextScore,
    current_question: Object.keys(state.answers).length + 1,
    total_questions: 6,
    progress: Math.round((Object.keys(state.answers).length / 6) * 100),
    answer_count: Object.keys(state.answers).length,
    remaining_seconds: state.remainingSeconds,
    last_activity: nowIso(),
    flagged: state.flagged,
    frozen: state.frozen,
    monitoring_status: state.frozen
      ? 'Session frozen - awaiting proctor review'
      : state.verificationRequired
      ? `Step-up required: ${state.config.step_up_method}`
      : state.riskLevel === 'High'
      ? 'Elevated risk - review closely'
      : state.riskLevel === 'Medium'
      ? 'Session anomaly monitoring active'
      : 'Normal',
    verification_required: state.verificationRequired,
    verification_reason: state.verificationReason,
    step_up_code_hint: state.stepUpCodeHint,
    step_up_count: 0,
    proctor_notice: state.proctorNotice,
    expected_release: '',
    submitted_at: state.sessionStatus === 'Completed' ? nowIso() : null,
    latest_snapshot: state.latestSnapshot,
    latest_snapshot_at: state.latestSnapshot ? nowIso() : null,
    risk_events: state.riskEvents,
    auth_records: state.authRecords,
    risk_history: state.riskHistory,
  }
}

function buildCandidateBootstrap(): CandidateBootstrap {
  return {
    user: CANDIDATE_USER,
    exam: MOCK_EXAM,
    session: buildCandidateSession(),
    questions: MOCK_QUESTIONS,
    answers: state.answers,
    config: state.config,
  }
}

function recalcRisk() {
  const score = Math.min(100, Math.round(state.config.ws * state.sessionScore + state.config.wf * state.contextScore))
  state.riskScore = score
  if (score >= state.config.high_risk_threshold) {
    state.riskLevel = 'High'
  } else if (score >= state.config.warning_threshold) {
    state.riskLevel = 'Medium'
  } else {
    state.riskLevel = 'Low'
  }
}

function pushRiskHistory(trigger: string) {
  state.riskHistory = [
    {
      id: `rh_${Date.now()}`,
      risk_score: state.riskScore,
      session_score: state.sessionScore,
      context_score: state.contextScore,
      risk_level: state.riskLevel,
      trigger,
      recorded_at: nowIso(),
    },
    ...state.riskHistory,
  ].slice(0, 12)
}

const CREDENTIALS: Record<string, { password: string; user: UserRecord }> = {
  cand001: { password: 'Exam@123', user: CANDIDATE_USER },
  proctor01: { password: 'Proctor@123', user: PROCTOR_USER },
  admin01: { password: 'Admin@123', user: ADMIN_USER },
}

export const mockApi = {
  health() {
    return delay({ status: 'ok', service: 'RA-MFA Demo (Mock)' })
  },

  login(username: string, password: string, role: 'candidate' | 'proctor' | 'admin'): Promise<LoginResponse> {
    const entry = CREDENTIALS[username]
    if (!entry || entry.password !== password || entry.user.role !== role) {
      return Promise.reject(new Error('Invalid username or password.'))
    }
    state.token = `mock_token_${Math.random().toString(36).slice(2)}`
    state.role = role
    state.userId = entry.user.id
    const response: LoginResponse = { token: state.token, user: entry.user }
    if (role === 'candidate' && state.sessionActive && state.sessionStatus !== 'Idle') {
      response.exam = MOCK_EXAM
      response.session = buildCandidateSession()
      response.resume_view = state.sessionActive ? 'candidate-exam' : 'candidate-verify'
    }
    return delay(response)
  },

  logout(_token: string) {
    void _token
    state.token = null
    state.role = null
    return delay({ success: true })
  },

  availableExams(_token: string): Promise<ExamRecord[]> {
    void _token
    return delay(state.exams.filter((exam) => exam.status === 'Active' || exam.status === 'Scheduled'))
  },

  candidateBootstrap(_token: string, _examId?: string): Promise<CandidateBootstrap> {
    void _token
    void _examId
    if (!state.sessionActive && state.sessionStatus === 'Idle') {
      state.sessionStatus = 'Verification'
    }
    return delay(buildCandidateBootstrap())
  },

  candidateFaceVerify(
    _token: string,
    _sessionId: string,
    imageData: string,
    stage: 'initial' | 'step_up',
    clientSimilarity?: number,
    clientPassed?: boolean,
  ) {
    const similarity = Math.round((clientSimilarity ?? 50) * 10) / 10
    const passed = clientPassed ?? similarity >= 85

    if (stage === 'initial') {
      state.sessionStatus = 'Verification'
      state.stepUpCodeHint = null
      state.authRecords = [
        {
          id: `ar_${Date.now()}`,
          method: 'Initial Face Verification',
          status: passed ? 'Passed' : 'Failed',
          triggered_by: 'Login entry gate',
          occurred_at: nowIso(),
        },
        ...state.authRecords,
      ]
      if (passed) {
        state.verified = true
      } else {
        state.verified = false
      }
    } else if (passed) {
      state.stepUpCodeHint = state.config.step_up_method === 'Face + OTP' ? '426381' : null
    } else {
      state.stepUpCodeHint = null
    }

    state.latestSnapshot = imageData
    return delay({ passed, similarity, session: buildCandidateSession() })
  },

  activateSession(_token: string, _sessionId: string): Promise<CandidateBootstrap> {
    void _token
    void _sessionId
    state.sessionActive = true
    state.sessionStatus = state.flagged ? 'Flagged' : 'Active'
    if (state.remainingSeconds === 3 * 60 * 60) {
      state.remainingSeconds = MOCK_EXAM.duration_seconds
    }
    return delay(buildCandidateBootstrap())
  },

  currentSession(_token: string, _sessionId: string): Promise<CandidateBootstrap> {
    void _token
    void _sessionId
    if (state.remainingSeconds > 0 && (state.sessionStatus === 'Active' || state.sessionStatus === 'Flagged')) {
      state.remainingSeconds = Math.max(0, state.remainingSeconds - 5)
    }
    return delay(buildCandidateBootstrap())
  },

  saveAnswer(_token: string, _sessionId: string, questionId: string, answer: string) {
    state.answers = { ...state.answers, [questionId]: answer }
    return delay({ answers: state.answers, session: buildCandidateSession() })
  },

  reportRiskEvent(_token: string, _sessionId: string, type: string, note?: string) {
    const eventMeta: Record<string, { label: string; category: 'S' | 'F'; points: number }> = {
      tab_switch: { label: 'Tab Switch Detected', category: 'S', points: 12 },
      blur_focus: { label: 'Window Focus Lost', category: 'S', points: 8 },
      fullscreen_exit: { label: 'Fullscreen Exited', category: 'S', points: 6 },
      copy_paste: { label: 'Copy/Paste Blocked', category: 'S', points: 14 },
      page_refresh: { label: 'Page Refresh Blocked', category: 'S', points: 10 },
      repeated_interrupt: { label: 'Repeated Interruptions', category: 'S', points: 20 },
      ip_change: { label: 'IP Address Changed', category: 'F', points: 18 },
      device_change: { label: 'Device Context Changed', category: 'F', points: 14 },
      network_reconnect: { label: 'Network Reconnected', category: 'F', points: 10 },
      webcam_interrupt: { label: 'Camera Verification Interrupted', category: 'F', points: 12 },
    }
    const meta = eventMeta[type] ?? { label: type, category: 'S' as const, points: 8 }
    const event = {
      id: `re_${Date.now()}`,
      type,
      label: meta.label,
      category: meta.category,
      points: meta.points,
      note: note ?? '',
      occurred_at: nowIso(),
    }
    state.riskEvents = [event, ...state.riskEvents]
    if (meta.category === 'S') {
      state.sessionScore = Math.min(100, state.sessionScore + meta.points)
    } else {
      state.contextScore = Math.min(100, state.contextScore + meta.points)
    }
    recalcRisk()
    pushRiskHistory(type)
    if (state.riskLevel === 'High' && !state.verificationRequired && !state.frozen) {
      state.verificationRequired = true
      state.verificationReason = `High risk threshold exceeded. Complete ${state.config.step_up_method} to continue.`
      state.sessionStatus = 'Verification'
      state.stepUpCodeHint = null
    }
    return delay({ session: buildCandidateSession(), config: state.config })
  },

  completeStepUp(_token: string, _sessionId: string, passed: boolean, method: string, otpCode?: string) {
    const expectedOtp = state.stepUpCodeHint
    const validatedPass =
      passed &&
      method === state.config.step_up_method &&
      (method !== 'Face + OTP' || otpCode?.trim() === expectedOtp)
    state.authRecords = [
      {
        id: `ar_su_${Date.now()}`,
        method,
        status: validatedPass ? 'Passed' : 'Failed',
        triggered_by: 'High risk detected',
        occurred_at: nowIso(),
      },
      ...state.authRecords,
    ]
    if (validatedPass) {
      state.verificationRequired = false
      state.verificationReason = null
      state.sessionStatus = state.flagged ? 'Flagged' : 'Active'
      state.sessionScore = Math.max(0, state.sessionScore - 12)
      state.contextScore = Math.max(0, state.contextScore - 8)
    } else {
      state.frozen = true
      state.flagged = true
      state.verificationRequired = false
      state.verificationReason = null
      state.sessionStatus = 'Frozen'
    }
    state.stepUpCodeHint = null
    recalcRisk()
    pushRiskHistory(method)
    return delay({ session: buildCandidateSession() })
  },

  submitSession(_token: string, _sessionId: string) {
    void _token
    void _sessionId
    state.sessionStatus = 'Completed'
    state.verificationRequired = false
    state.verificationReason = null
    state.stepUpCodeHint = null
    const result: SubmitResult = {
      session_id: state.sessionId,
      submitted_at: nowIso(),
      release_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      risk_score: state.riskScore,
      risk_level: state.riskLevel,
      flagged: state.flagged,
      reauth_count: state.authRecords.filter((record) => record.method !== 'Initial Face Verification').length,
      answered: Object.keys(state.answers).length,
      total_questions: 6,
    }
    pushRiskHistory('Exam submitted')
    return delay({ result, session: buildCandidateSession() })
  },

  proctorDashboard(_token: string): Promise<ProctorDashboardData> {
    void _token
    const sessions = state.proctorSessions
    return delay({
      exam: MOCK_EXAM,
      exams: [MOCK_EXAM, MOCK_EXAM_2],
      summary: {
        total_students: sessions.length,
        active: sessions.filter((session) => session.status === 'Active' || session.status === 'Verification').length,
        completed: sessions.filter((session) => session.status === 'Completed').length,
        flagged: sessions.filter((session) => session.flagged).length,
      },
      sessions,
    })
  },

  sendNotice(_token: string, sessionId: string, message: string) {
    const idx = state.proctorSessions.findIndex((session) => session.id === sessionId)
    if (idx !== -1) {
      state.proctorSessions[idx] = { ...state.proctorSessions[idx], proctor_notice: message }
    }
    return delay({ session: state.proctorSessions[idx] ?? state.proctorSessions[0] })
  },

  freezeSession(_token: string, sessionId: string) {
    const idx = state.proctorSessions.findIndex((session) => session.id === sessionId)
    if (idx !== -1) {
      state.proctorSessions[idx] = { ...state.proctorSessions[idx], frozen: true, flagged: true, status: 'Frozen', monitoring_status: 'Session frozen by proctor.' }
    }
    return delay({ session: state.proctorSessions[idx] ?? state.proctorSessions[0] })
  },

  unfreezeSession(_token: string, sessionId: string) {
    const idx = state.proctorSessions.findIndex((session) => session.id === sessionId)
    if (idx !== -1) {
      state.proctorSessions[idx] = { ...state.proctorSessions[idx], frozen: false, status: 'Active', monitoring_status: 'Session anomaly monitoring active' }
    }
    return delay({ session: state.proctorSessions[idx] ?? state.proctorSessions[0] })
  },

  clearSnapshot(_token: string, sessionId: string) {
    const idx = state.proctorSessions.findIndex((session) => session.id === sessionId)
    if (idx !== -1) {
      state.proctorSessions[idx] = { ...state.proctorSessions[idx], latest_snapshot: null, latest_snapshot_at: null }
    }
    return delay({ session: state.proctorSessions[idx] ?? state.proctorSessions[0] })
  },

  adminBootstrap(_token: string): Promise<AdminBootstrap> {
    void _token
    return delay({ users: state.users, exams: state.exams, config: state.config })
  },

  saveConfig(_token: string, config: RiskConfig) {
    state.config = { ...config, updated_at: nowIso() }
    return delay({ config: state.config })
  },

  saveUser(_token: string, payload: UserRecord & { password: string }) {
    const idx = state.users.findIndex((user) => user.id === payload.id)
    const user: UserRecord = {
      id: payload.id || `user_${Date.now()}`,
      username: payload.username,
      role: payload.role,
      real_name: payload.real_name,
      status: payload.status,
      reference_photo: payload.reference_photo ?? null,
    }
    if (idx !== -1) {
      state.users[idx] = user
    } else {
      state.users = [...state.users, user]
    }
    return delay({ user })
  },

  toggleUserStatus(_token: string, userId: string) {
    const idx = state.users.findIndex((user) => user.id === userId)
    if (idx !== -1) {
      state.users[idx] = {
        ...state.users[idx],
        status: state.users[idx].status === 'Active' ? 'Disabled' : 'Active',
      }
    }
    return delay({ user: state.users[idx] })
  },

  saveExam(_token: string, exam: ExamRecord) {
    const idx = state.exams.findIndex((item) => item.id === exam.id)
    const next = { ...exam, id: exam.id || `exam_${Date.now()}` }
    if (idx !== -1) {
      state.exams[idx] = next
    } else {
      state.exams = [...state.exams, next]
    }
    return delay({ exam: next })
  },

  deleteExam(_token: string, examId: string) {
    state.exams = state.exams.filter((exam) => exam.id !== examId)
    return delay({ success: true })
  },

  deleteRiskEvent(_token: string, _sessionId: string, eventId: string) {
    const targetSessionId =
      state.proctorSessions.find((session) => session.risk_events.some((event) => event.id === eventId))?.id ??
      state.proctorSessions[0]?.id
    state.proctorSessions = state.proctorSessions.map((session) => ({
      ...session,
      risk_events: session.risk_events.filter((event) => event.id !== eventId),
    }))
    const updated = state.proctorSessions.find((session) => session.id === targetSessionId) ?? state.proctorSessions[0]
    return delay({ session: updated })
  },

  getQuestions(_token: string, examId: string) {
    return delay(state.questions.filter((question) => question.exam_id === examId))
  },

  saveQuestion(_token: string, question: QuestionRecord & { exam_id: string }) {
    const next = question.id ? question : { ...question, id: `q_mock_${Date.now()}` }
    const idx = state.questions.findIndex((existing) => existing.id === next.id)
    if (idx !== -1) {
      state.questions[idx] = next
    } else {
      state.questions.push(next)
    }
    return delay({ question: next })
  },

  deleteQuestion(_token: string, questionId: string) {
    state.questions = state.questions.filter((question) => question.id !== questionId)
    return delay({ success: true })
  },

  resetExamSessions(_token: string, examId: string) {
    const deleted = state.proctorSessions.filter((session) => session.exam_id === examId).length
    state.proctorSessions = state.proctorSessions.filter((session) => session.exam_id !== examId)
    return delay({ success: true, deleted_sessions: deleted })
  },
}
