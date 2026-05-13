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
import { mockApi } from './api.mock'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    })
  } catch {
    throw new Error('Unable to connect to the backend service. Please start the API server and try again.')
  }

  if (!response.ok) {
    let message = `Request failed with ${response.status}`
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      message = 'The backend service is temporarily unavailable. Please start the API server and try again.'
    }
    try {
      const payload = (await response.json()) as { detail?: string }
      if (payload.detail) {
        message = payload.detail
      }
    } catch {
      // Ignore non-JSON error bodies and fall back to the HTTP status text.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

const realApi = {
  health() {
    return request<{ status: string; service: string }>('/api/health')
  },
  login(username: string, password: string, role: 'candidate' | 'proctor' | 'admin') {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    })
  },
  logout(token: string) {
    return request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }, token)
  },
  availableExams(token: string) {
    return request<ExamRecord[]>('/api/candidate/exams', {}, token)
  },
  candidateBootstrap(token: string, examId?: string) {
    const path = examId
      ? `/api/candidate/bootstrap?exam_id=${encodeURIComponent(examId)}`
      : '/api/candidate/bootstrap'
    return request<CandidateBootstrap>(path, {}, token)
  },
  candidateFaceVerify(
    token: string,
    sessionId: string,
    imageData: string,
    stage: 'initial' | 'step_up',
    clientSimilarity?: number,
    clientPassed?: boolean,
  ) {
    return request<{ passed: boolean; similarity: number; session: CandidateSession }>(
      '/api/candidate/face-verify',
      {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          image_data: imageData,
          stage,
          client_similarity: clientSimilarity ?? null,
          client_passed: clientPassed ?? null,
        }),
      },
      token,
    )
  },
  activateSession(token: string, sessionId: string) {
    return request<CandidateBootstrap>(
      `/api/candidate/session/activate?session_id=${encodeURIComponent(sessionId)}`,
      { method: 'POST' },
      token,
    )
  },
  currentSession(token: string, sessionId: string) {
    return request<CandidateBootstrap>(
      `/api/candidate/session/current?session_id=${encodeURIComponent(sessionId)}`,
      {},
      token,
    )
  },
  saveAnswer(token: string, sessionId: string, questionId: string, answer: string) {
    return request<{ answers: Record<string, string>; session: CandidateSession }>(
      '/api/candidate/session/answer',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, question_id: questionId, answer }),
      },
      token,
    )
  },
  reportRiskEvent(token: string, sessionId: string, type: string, note?: string, meta?: Record<string, unknown>) {
    return request<{ session: CandidateSession; config: RiskConfig }>(
      '/api/candidate/session/risk-event',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, type, note, meta: meta ?? {} }),
      },
      token,
    )
  },
  completeStepUp(token: string, sessionId: string, passed: boolean, method: string, otpCode?: string) {
    return request<{ session: CandidateSession }>(
      '/api/candidate/session/step-up',
      {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          passed,
          method,
          otp_code: otpCode ?? null,
        }),
      },
      token,
    )
  },
  submitSession(token: string, sessionId: string) {
    return request<{ result: SubmitResult; session: CandidateSession }>(
      `/api/candidate/session/submit?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
      },
      token,
    )
  },
  proctorDashboard(token: string) {
    return request<ProctorDashboardData>('/api/proctor/dashboard', {}, token)
  },
  sendNotice(token: string, sessionId: string, message: string) {
    return request<{ session: CandidateSession }>(
      `/api/proctor/sessions/${sessionId}/notice`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      },
      token,
    )
  },
  freezeSession(token: string, sessionId: string) {
    return request<{ session: CandidateSession }>(
      `/api/proctor/sessions/${sessionId}/freeze`,
      { method: 'POST' },
      token,
    )
  },
  unfreezeSession(token: string, sessionId: string) {
    return request<{ session: CandidateSession }>(
      `/api/proctor/sessions/${sessionId}/unfreeze`,
      { method: 'POST' },
      token,
    )
  },
  clearSnapshot(token: string, sessionId: string) {
    return request<{ session: CandidateSession }>(
      `/api/proctor/sessions/${sessionId}/snapshot`,
      { method: 'DELETE' },
      token,
    )
  },
  adminBootstrap(token: string) {
    return request<AdminBootstrap>('/api/admin/bootstrap', {}, token)
  },
  saveConfig(token: string, config: RiskConfig) {
    return request<{ config: RiskConfig }>(
      '/api/admin/config',
      {
        method: 'PUT',
        body: JSON.stringify(config),
      },
      token,
    )
  },
  saveUser(
    token: string,
    payload: UserRecord & { password: string },
  ) {
    return request<{ user: UserRecord }>(
      '/api/admin/users',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    )
  },
  toggleUserStatus(token: string, userId: string) {
    return request<{ user: UserRecord }>(
      `/api/admin/users/${userId}/toggle-status`,
      {
        method: 'POST',
      },
      token,
    )
  },
  saveExam(token: string, exam: ExamRecord) {
    return request<{ exam: ExamRecord }>(
      '/api/admin/exams',
      {
        method: 'POST',
        body: JSON.stringify(exam),
      },
      token,
    )
  },
  deleteExam(token: string, examId: string) {
    return request<{ success: boolean }>(
      `/api/admin/exams/${examId}`,
      { method: 'DELETE' },
      token,
    )
  },
  resetExamSessions(token: string, examId: string) {
    return request<{ success: boolean; deleted_sessions: number }>(
      `/api/admin/exams/${examId}/reset-sessions`,
      { method: 'POST' },
      token,
    )
  },
  deleteRiskEvent(token: string, _sessionId: string, eventId: string) {
    return request<{ session: CandidateSession }>(
      `/api/proctor/events/${eventId}`,
      { method: 'DELETE' },
      token,
    )
  },
  getQuestions(token: string, examId: string) {
    return request<QuestionRecord[]>(
      `/api/admin/questions?exam_id=${encodeURIComponent(examId)}`,
      {},
      token,
    )
  },
  saveQuestion(token: string, question: QuestionRecord & { exam_id: string }) {
    return request<{ question: QuestionRecord }>(
      '/api/admin/questions',
      { method: 'POST', body: JSON.stringify(question) },
      token,
    )
  },
  deleteQuestion(token: string, questionId: string) {
    return request<{ success: boolean }>(
      `/api/admin/questions/${questionId}`,
      { method: 'DELETE' },
      token,
    )
  },
}

export const api = import.meta.env.VITE_DEMO === 'true' ? mockApi : realApi
