export type Role = 'candidate' | 'proctor' | 'admin'
export type PortalView =
  | 'landing'
  | 'candidate-login'
  | 'candidate-select'
  | 'candidate-verify'
  | 'candidate-exam'
  | 'candidate-result'
  | 'proctor-login'
  | 'proctor-dashboard'
  | 'admin-login'
  | 'admin-config'
  | 'admin-users'
  | 'admin-exams'
  | 'admin-questions'

export interface UserRecord {
  id: string
  username: string
  role: Role
  real_name: string
  status: 'Active' | 'Disabled'
  reference_photo: string | null
}

export interface ExamRecord {
  id: string
  title: string
  subject: string
  start_time: string
  end_time: string
  status: 'Draft' | 'Scheduled' | 'Active' | 'Completed'
  total_questions: number
  total_score: number
  candidate_count: number
  duration_seconds: number
  submitted?: boolean   // 当前考生是否已提交（仅候选人端视角，管理员/监考不含此字段）
}

export interface QuestionOption {
  id: string
  label: string
  text: string
}

export interface QuestionRecord {
  id: string
  number: number
  score: number
  type: 'short' | 'textarea' | 'truefalse' | 'mcq'
  category: string
  prompt: string
  placeholder: string
  options: QuestionOption[]
}

export interface RiskEvent {
  id: string
  type: string
  label: string
  category: 'S' | 'F' | 'System'
  points: number
  note: string
  occurred_at: string
}

export interface AuthRecord {
  id: string
  method: string
  status: 'Passed' | 'Failed' | 'Pending'
  triggered_by: string
  occurred_at: string
}

export interface RiskHistoryRecord {
  id: string
  risk_score: number
  session_score: number
  context_score: number
  risk_level: 'Low' | 'Medium' | 'High'
  trigger: string
  recorded_at: string
}

export interface CandidateSession {
  id: string
  candidate_name: string
  exam_id: string
  status: 'Active' | 'Verification' | 'Frozen' | 'Completed' | 'Flagged' | 'Idle'
  risk_level: 'Low' | 'Medium' | 'High'
  risk_score: number
  session_score: number
  context_score: number
  current_question: number
  total_questions: number
  progress: number
  answer_count: number
  remaining_seconds: number
  last_activity: string
  flagged: boolean
  frozen: boolean
  monitoring_status: string
  verification_required: boolean
  verification_reason: string | null
  step_up_code_hint?: string | null
  step_up_count: number
  proctor_notice: string | null
  expected_release: string
  submitted_at: string | null
  latest_snapshot: string | null
  latest_snapshot_at: string | null
  risk_events: RiskEvent[]
  auth_records: AuthRecord[]
  risk_history: RiskHistoryRecord[]
}

export interface RiskConfig {
  ws: number
  wf: number
  warning_threshold: number
  high_risk_threshold: number
  idle_timeout_sec: number
  suspicious_threshold: number
  warning_time_min: number
  danger_time_min: number
  step_up_method: 'Face Re-Verification' | 'Face + OTP'
  session_weights: Record<string, number>
  context_weights: Record<string, number>
  scoring_weights: Record<string, number>
  updated_at: string
}

export interface LoginResponse {
  token: string
  user: UserRecord
  exam?: ExamRecord
  session?: CandidateSession
  resume_view?: PortalView
}

export interface CandidateBootstrap {
  user: UserRecord
  exam: ExamRecord
  session: CandidateSession
  questions: QuestionRecord[]
  answers: Record<string, string>
  config: RiskConfig
}

export interface SubmitResult {
  session_id: string
  submitted_at: string
  release_at: string
  risk_score: number
  risk_level: 'Low' | 'Medium' | 'High'
  flagged: boolean
  reauth_count: number
  answered: number
  total_questions: number
}

export interface ProctorDashboardData {
  exam: ExamRecord          // 向后兼容：第一个活跃考试
  exams: ExamRecord[]       // 所有活跃考试列表
  summary: {
    total_students: number
    active: number
    completed: number
    flagged: number
  }
  sessions: CandidateSession[]  // 跨所有活跃考试的会话
}

export interface AdminBootstrap {
  users: UserRecord[]
  exams: ExamRecord[]
  config: RiskConfig
}
