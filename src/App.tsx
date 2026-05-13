/**
 * App.tsx — 应用根组件（状态管理 + 路由调度）
 *
 * 职责：
 *  1. 持有全局状态（登录信息、考试数据、考生会话、监考数据、管理配置）
 *  2. 封装所有 API 调用逻辑，以回调函数形式传递给各子组件
 *  3. 根据当前视图（view 状态）渲染对应的页面组件
 *
 * 不包含任何 UI 渲染细节，所有视觉组件均在 src/components/ 中单独定义。
 */

import { lazy, useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import './App.css'
import type { EditableUser } from './components/AdminPanel'
import type {
  AdminBootstrap,
  CandidateBootstrap,
  CandidateSession,
  ExamRecord,
  PortalView,
  ProctorDashboardData,
  QuestionRecord,
  RiskConfig,
  Role,
  SubmitResult,
  UserRecord,
} from './types'

const AdminPanel = lazy(() => import('./components/AdminPanel').then((module) => ({ default: module.AdminPanel })))
const CandidateExam = lazy(() => import('./components/CandidateExam').then((module) => ({ default: module.CandidateExam })))
const ExamSelectPage = lazy(() => import('./components/ExamSelectPage').then((module) => ({ default: module.ExamSelectPage })))
const LandingPage = lazy(() => import('./components/LandingPage').then((module) => ({ default: module.LandingPage })))
const LoginPortal = lazy(() => import('./components/LoginPortal').then((module) => ({ default: module.LoginPortal })))
const ProctorDashboardV2 = lazy(() => import('./components/ProctorDashboardV2').then((module) => ({ default: module.ProctorDashboardV2 })))
const QuestionEditor = lazy(() => import('./components/QuestionEditor').then((module) => ({ default: module.QuestionEditor })))
const ResultPage = lazy(() => import('./components/ResultPage').then((module) => ({ default: module.ResultPage })))
const VerificationPage = lazy(() => import('./components/VerificationPage').then((module) => ({ default: module.VerificationPage })))

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 登录后持久化的鉴权信息 */
interface AuthState {
  token: string
  user: UserRecord
}

function readStoredAuth(): AuthState | null {
  const saved = sessionStorage.getItem('ra_mfa_auth')
  if (!saved) return null
  try {
    return JSON.parse(saved) as AuthState
  } catch {
    sessionStorage.removeItem('ra_mfa_auth')
    return null
  }
}

// ─────────────────────────────────────────────
// 初始表单状态
// ─────────────────────────────────────────────

/** 用户表单的空白初始值 */
const EMPTY_USER_FORM: EditableUser = {
  id: '', username: '', role: 'candidate', real_name: '',
  status: 'Active', password: '', reference_photo: '',
}

/** 考试表单的空白初始值 */
const EMPTY_EXAM_FORM: ExamRecord = {
  id: '', title: '', subject: 'Computer Science',
  start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  end_time: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString().slice(0, 16),
  status: 'Scheduled', total_questions: 20, total_score: 100,
  candidate_count: 20, duration_seconds: 3 * 60 * 60,
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

function App() {
  // ── 视图路由 ──
  const roleParam = new URLSearchParams(window.location.search).get('role')
  const initialView: PortalView =
    roleParam === 'candidate' ? 'candidate-login' :
    roleParam === 'proctor'   ? 'proctor-login' :
    'landing'
  const [view, setView] = useState<PortalView>(initialView)

  // ── 鉴权信息 ──
  const [auth, setAuth] = useState<AuthState | null>(() => readStoredAuth())

  // ── 考生端状态 ──
  const [config, setConfig] = useState<RiskConfig | null>(null)
  const [exam, setExam] = useState<ExamRecord | null>(null)
  const [candidateSession, setCandidateSession] = useState<CandidateSession | null>(null)
  const [candidateQuestions, setCandidateQuestions] = useState<QuestionRecord[]>([])
  const [candidateAnswers, setCandidateAnswers] = useState<Record<string, string>>({})
  const [candidateResult, setCandidateResult] = useState<SubmitResult | null>(null)
  const [candidateExams, setCandidateExams] = useState<ExamRecord[]>([])

  // ── 监考员端状态 ──
  const [proctorData, setProctorData] = useState<ProctorDashboardData | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState('')

  // ── 管理员端状态 ──
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
  const [adminExams, setAdminExams] = useState<ExamRecord[]>([])
  const [userForm, setUserForm] = useState<EditableUser>(EMPTY_USER_FORM)
  const [examForm, setExamForm] = useState<ExamRecord>(EMPTY_EXAM_FORM)
  const [adminQuestions, setAdminQuestions] = useState<QuestionRecord[]>([])
  const [questionExam, setQuestionExam] = useState<ExamRecord | null>(null)

  // ── 全局错误提示 ──
  const [pageError, setPageError] = useState('')

  // 答题防抖计时器：每道题最多每 400ms 保存一次
  const answerTimersRef = useRef<Record<string, number>>({})

  // ─────────────────────────────────────────────
  // 数据同步辅助函数
  // ─────────────────────────────────────────────

  /** 将后端返回的考生 Bootstrap 数据批量写入各状态 */
  const applyCandidateBootstrap = useCallback((payload: CandidateBootstrap) => {
    setExam(payload.exam)
    setCandidateSession(payload.session)
    setCandidateQuestions(payload.questions)
    setCandidateAnswers(payload.answers)
    setConfig(payload.config)
  }, [])

  /** 将后端返回的管理员 Bootstrap 数据批量写入各状态 */
  const applyAdminBootstrap = useCallback((payload: AdminBootstrap) => {
    setAdminUsers(payload.users)
    setAdminExams(payload.exams)
    setConfig(payload.config)
  }, [])

  /** 刷新考生当前会话（考试中每 5 秒轮询） */
  const refreshCandidateSession = useCallback(async (token: string) => {
    if (!candidateSession) return
    const payload = await api.currentSession(token, candidateSession.id)
    applyCandidateBootstrap(payload)
  }, [applyCandidateBootstrap, candidateSession])

  /** 刷新监考员仪表盘（每 4 秒轮询） */
  const refreshProctorDashboard = useCallback(async (token: string) => {
    const payload = await api.proctorDashboard(token)
    setProctorData(payload)
    // 如果尚未选中任何会话，默认选中第一个
    if (!selectedSessionId && payload.sessions[0]) {
      setSelectedSessionId(payload.sessions[0].id)
    }
  }, [selectedSessionId])

  /** 刷新管理员数据 */
  const refreshAdminData = useCallback(async (token: string) => {
    const payload = await api.adminBootstrap(token)
    applyAdminBootstrap(payload)
  }, [applyAdminBootstrap])

  /**
   * 用单条更新的 session 替换 proctorData 中的对应项
   * 所有监考员操作（冻结、解冻、发通知、删帧、删事件）均用此函数
   * 替代全量刷新，确保操作即时生效且不依赖网络二次请求
   */
  function applySessionUpdate(updated: CandidateSession) {
    setProctorData((prev) =>
      prev
        ? { ...prev, sessions: prev.sessions.map((s) => (s.id === updated.id ? updated : s)) }
        : prev,
    )
  }

  /** 清空登录后的所有本地状态（退出时调用） */
  function resetLocalState() {
    setConfig(null)
    setExam(null)
    setCandidateSession(null)
    setCandidateQuestions([])
    setCandidateAnswers({})
    setCandidateResult(null)
    setProctorData(null)
    setAdminUsers([])
    setAdminExams([])
    setCandidateExams([])
    setSelectedSessionId('')
    setUserForm(EMPTY_USER_FORM)
    setExamForm(EMPTY_EXAM_FORM)
    setPageError('')
  }

  // ─────────────────────────────────────────────
  // 刷新自动恢复（sessionStorage 持久化 auth）
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!auth) return
    const { token, user } = auth
    const timer = window.setTimeout(() => {
      if (user.role === 'candidate') {
        // Go to exam-select first (safe); the "Exam In Progress" banner handles active sessions
        api.availableExams(token)
          .then((exams) => { setCandidateExams(exams); setView('candidate-select') })
          .catch(() => { sessionStorage.removeItem('ra_mfa_auth'); setAuth(null) })
      } else if (user.role === 'proctor') {
        refreshProctorDashboard(token)
          .then(() => setView('proctor-dashboard'))
          .catch(() => { sessionStorage.removeItem('ra_mfa_auth'); setAuth(null) })
      } else if (user.role === 'admin') {
        refreshAdminData(token)
          .then(() => setView('admin-config'))
          .catch(() => { sessionStorage.removeItem('ra_mfa_auth'); setAuth(null) })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────
  // 定时轮询
  // ─────────────────────────────────────────────

  // 考生考试中：每 5 秒同步一次会话状态（倒计时、风险分等）
  useEffect(() => {
    if (auth?.user.role !== 'candidate' || view !== 'candidate-exam') return
    const timer = window.setInterval(() => {
      void refreshCandidateSession(auth.token).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [auth, refreshCandidateSession, view])

  // 考生在选择/验证页面时：若有活跃会话则每 5 秒轮询（检测冻结/解冻通知）
  useEffect(() => {
    if (auth?.user.role !== 'candidate') return
    if (view !== 'candidate-select' && view !== 'candidate-verify') return
    if (!candidateSession || candidateSession.status === 'Completed' || candidateSession.status === 'Idle') return
    const timer = window.setInterval(() => {
      void refreshCandidateSession(auth.token).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [auth, candidateSession, refreshCandidateSession, view])

  // 监考员仪表盘：每 4 秒刷新所有会话数据
  useEffect(() => {
    if (auth?.user.role !== 'proctor' || view !== 'proctor-dashboard') return
    const timer = window.setInterval(() => {
      void refreshProctorDashboard(auth.token).catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [auth, refreshProctorDashboard, view])

  // ─────────────────────────────────────────────
  // 鉴权操作
  // ─────────────────────────────────────────────

  /** 退出登录：调用后端接口 → 清空本地状态 → 跳回首页 */
  async function logout() {
    if (auth) {
      try { await api.logout(auth.token) } catch { /* 静默忽略退出失败 */ }
    }
    sessionStorage.removeItem('ra_mfa_auth')
    setAuth(null)
    resetLocalState()
    setView('landing')
  }

  /**
   * 登录：验证账号 → 设置 auth → 根据角色拉取初始数据 → 跳转目标页面
   * 返回错误信息字符串（成功返回 null）供 LoginPortal 显示
   */
  async function handleLogin(username: string, password: string, role: Role) {
    try {
      setPageError('')
      const login = await api.login(username, password, role)
      setAuth({ token: login.token, user: login.user })
      sessionStorage.setItem('ra_mfa_auth', JSON.stringify({ token: login.token, user: login.user }))

      if (role === 'candidate') {
        // 如果上次有未完成的考试会话，直接恢复
        if (login.resume_view === 'candidate-exam') {
          const bootstrap = await api.candidateBootstrap(login.token)
          applyCandidateBootstrap(bootstrap)
          setView('candidate-exam')
          return null
        }
        const exams = await api.availableExams(login.token)
        setCandidateExams(exams)
        setView('candidate-select')
        return null
      }

      if (role === 'proctor') {
        await refreshProctorDashboard(login.token)
        setView('proctor-dashboard')
        return null
      }

      await refreshAdminData(login.token)
      setView('admin-config')
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.'
      setPageError(message)
      return message
    }
  }

  // ─────────────────────────────────────────────
  // 考生端操作
  // ─────────────────────────────────────────────

  /** 选择考试：加载题目和会话数据，根据session状态路由 */
  async function handleExamSelect(examId: string) {
    if (!auth) return
    try {
      setPageError('')
      const bootstrap = await api.candidateBootstrap(auth.token, examId)
      applyCandidateBootstrap(bootstrap)
      const s = bootstrap.session
      // 'Verification' with verification_required=false means brand-new session (needs initial face check)
      // 'Verification' with verification_required=true means step-up during an already-started exam
      const alreadyStarted =
        s.status === 'Active' || s.status === 'Flagged' || s.status === 'Frozen' ||
        (s.status === 'Verification' && s.verification_required)
      setView(alreadyStarted ? 'candidate-exam' : 'candidate-verify')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load exam.')
    }
  }

  /**
   * 答题变化：本地状态立即更新（保证 UI 响应），
   * 400ms 防抖后向后端保存（减少请求频率）
   */
  function handleAnswerChange(questionId: string, value: string) {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) return
    setCandidateAnswers((cur) => ({ ...cur, [questionId]: value }))
    const existing = answerTimersRef.current[questionId]
    if (existing) window.clearTimeout(existing)
    answerTimersRef.current[questionId] = window.setTimeout(() => {
      void api.saveAnswer(auth.token, candidateSession.id, questionId, value)
        .then((res) => { setCandidateAnswers(res.answers); setCandidateSession(res.session) })
        .catch((err: unknown) => {
          setPageError(err instanceof Error ? err.message : 'Unable to save the answer.')
        })
    }, 400)
  }

  /** 激活考场会话（通过验证后进入考试） */
  async function activateCandidateSession() {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) return
    try {
      const payload = await api.activateSession(auth.token, candidateSession.id)
      applyCandidateBootstrap(payload)
      setView('candidate-exam')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to activate the exam session.')
    }
  }

  /** 人脸身份核验（考前初始验证或加强验证） */
  async function verifyCandidateIdentity(imageData: string, clientSimilarity?: number, clientPassed?: boolean) {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) {
      return { passed: false, similarity: 0 }
    }
    try {
      const response = await api.candidateFaceVerify(
        auth.token,
        candidateSession.id,
        imageData,
        'initial',
        clientSimilarity,
        clientPassed,
      )
      if (response.session) setCandidateSession(response.session)
      return { passed: response.passed, similarity: response.similarity }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Verification failed.'
      setPageError(msg)
      return { passed: false, similarity: 0, error: msg }
    }
  }

  /** 高风险状态下的临时人脸验证 */
  async function verifyStepUpFace(imageData: string, clientSimilarity?: number, clientPassed?: boolean) {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) {
      return { passed: false, similarity: 0, stepUpCodeHint: null }
    }
    const response = await api.candidateFaceVerify(
      auth.token,
      candidateSession.id,
      imageData,
      'step_up',
      clientSimilarity,
      clientPassed,
    )
    setCandidateSession(response.session)
    return {
      passed: response.passed,
      similarity: response.similarity,
      stepUpCodeHint: response.session?.step_up_code_hint ?? null,
    }
  }

  /** 上报风险事件（切换标签、失焦、复制粘贴等行为触发） */
  async function reportRiskEvent(type: string, note?: string, meta?: Record<string, unknown>) {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) return
    try {
      const response = await api.reportRiskEvent(auth.token, candidateSession.id, type, note, meta)
      setCandidateSession(response.session)
      setConfig(response.config)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to record the risk event.')
    }
  }

  /** 完成加强验证流程（提交结果 passed/failed 和验证方式） */
  async function completeStepUp(passed: boolean, method: string, otpCode?: string) {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) return
    try {
      const response = await api.completeStepUp(auth.token, candidateSession.id, passed, method, otpCode)
      setCandidateSession(response.session)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to finish the step-up verification.')
    }
  }

  /** 提交试卷（正常提交或退出放弃均调用此函数，退出时答题为空则得 0 分） */
  async function submitExam() {
    if (!auth || auth.user.role !== 'candidate' || !candidateSession) return
    try {
      const response = await api.submitSession(auth.token, candidateSession.id)
      setCandidateResult(response.result)
      setCandidateSession(response.session)
      setView('candidate-result')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to submit the exam.')
    }
  }

  /**
   * 提交完成后返回考试选择页（不退出登录）
   * 刷新考试列表，保留已提交会话状态供 ExamSelectPage 显示"已完成"标记
   */
  async function returnToDashboardAfterExam() {
    if (!auth) return
    try {
      const exams = await api.availableExams(auth.token)
      setCandidateExams(exams)
    } catch { /* 静默忽略，已有旧列表兜底 */ }
    setPageError('')
    setView('candidate-select')
  }

  // ─────────────────────────────────────────────
  // 监考员端操作（均使用 applySessionUpdate 直接更新状态）
  // ─────────────────────────────────────────────

  /** 向考生发送通知 */
  async function sendProctorNotice(sessionId: string, message: string) {
    if (!auth || auth.user.role !== 'proctor') return
    try {
      const response = await api.sendNotice(auth.token, sessionId, message)
      applySessionUpdate(response.session)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to send notice.')
    }
  }

  /** 冻结考生会话（阻止考生进行任何操作） */
  async function freezeSession(sessionId: string) {
    if (!auth || auth.user.role !== 'proctor') return
    try {
      const response = await api.freezeSession(auth.token, sessionId)
      applySessionUpdate(response.session)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to freeze session.')
    }
  }

  /** 解冻考生会话 */
  async function unfreezeSession(sessionId: string) {
    if (!auth || auth.user.role !== 'proctor') return
    try {
      const response = await api.unfreezeSession(auth.token, sessionId)
      applySessionUpdate(response.session)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to unfreeze session.')
    }
  }

  /** 删除最新监控帧截图 */
  async function clearSessionSnapshot(sessionId: string) {
    if (!auth || auth.user.role !== 'proctor') return
    try {
      const response = await api.clearSnapshot(auth.token, sessionId)
      applySessionUpdate(response.session)  // 直接用返回值更新，无需全量刷新
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to delete snapshot.')
    }
  }

  /**
   * 删除单条风险事件记录
   * 后端删除后返回更新后的 session，直接用 applySessionUpdate 更新前端，
   * incidentHistory 由 proctorData.sessions 派生，会自动重新计算。
   */
  async function deleteRiskEvent(sessionId: string, eventId: string) {
    if (!auth || auth.user.role !== 'proctor') return
    try {
      const response = await api.deleteRiskEvent(auth.token, sessionId, eventId)
      applySessionUpdate(response.session)  // 直接更新，不做全量刷新
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to delete event.')
    }
  }

  // ─────────────────────────────────────────────
  // 管理员端操作
  // ─────────────────────────────────────────────

  async function saveConfig(nextConfig: RiskConfig) {
    if (!auth || auth.user.role !== 'admin') return
    const response = await api.saveConfig(auth.token, nextConfig)
    setConfig(response.config)
  }

  async function saveUser(nextUser: EditableUser) {
    if (!auth || auth.user.role !== 'admin') return
    await api.saveUser(auth.token, nextUser)
    await refreshAdminData(auth.token)
    setUserForm(EMPTY_USER_FORM)
  }

  async function toggleUserStatus(userId: string) {
    if (!auth || auth.user.role !== 'admin') return
    await api.toggleUserStatus(auth.token, userId)
    await refreshAdminData(auth.token)
  }

  async function saveExam(nextExam: ExamRecord) {
    if (!auth || auth.user.role !== 'admin') return
    await api.saveExam(auth.token, nextExam)
    await refreshAdminData(auth.token)
    setExamForm(EMPTY_EXAM_FORM)
  }

  async function removeExam(examId: string) {
    if (!auth || auth.user.role !== 'admin') return
    await api.deleteExam(auth.token, examId)
    await refreshAdminData(auth.token)
  }

  /** 重置考试所有会话（发布前清除测试数据） */
  async function resetExamSessions(examId: string) {
    if (!auth || auth.user.role !== 'admin') return
    try {
      const res = await api.resetExamSessions(auth.token, examId)
      setPageError('')
      alert(`Session reset complete. ${res.deleted_sessions} session(s) deleted.`)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to reset sessions.')
    }
  }

  /** 进入题目管理页面：加载该考试的题目列表 */
  async function manageQuestions(targetExam: ExamRecord) {
    if (!auth || auth.user.role !== 'admin') return
    try {
      const questions = await api.getQuestions(auth.token, targetExam.id)
      setAdminQuestions(questions)
      setQuestionExam(targetExam)
      setView('admin-questions')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load questions.')
    }
  }

  /** 保存题目（新建或更新），刷新本地题目列表 */
  async function saveQuestion(question: QuestionRecord & { exam_id: string }) {
    if (!auth || auth.user.role !== 'admin') return
    await api.saveQuestion(auth.token, question)
    // 刷新题目列表
    const updated = await api.getQuestions(auth.token, question.exam_id)
    setAdminQuestions(updated)
    // 同步考试的 total_questions
    await refreshAdminData(auth.token)
  }

  /** 删除题目，刷新本地题目列表 */
  async function deleteQuestion(questionId: string) {
    if (!auth || auth.user.role !== 'admin' || !questionExam) return
    await api.deleteQuestion(auth.token, questionId)
    const updated = await api.getQuestions(auth.token, questionExam.id)
    setAdminQuestions(updated)
    await refreshAdminData(auth.token)
  }

  // ─────────────────────────────────────────────
  // 视图路由
  // ─────────────────────────────────────────────

  // 当前选中的监考会话（优先选 selectedSessionId，否则默认第一个）
  const activeSelectedSession =
    proctorData?.sessions.find((s) => s.id === selectedSessionId) ??
    proctorData?.sessions[0] ??
    null

  // ── 考生登录页 ──
  if (view === 'candidate-login') {
    return (
      <LoginPortal
        variant="candidate"
        title="Candidate Sign In"
        description="Sign in to access your scheduled exam."
        hint="Contact your administrator for login credentials."
        onBack={() => setView('landing')}
        onSubmit={(u, p) => handleLogin(u, p, 'candidate')}
        error={pageError}
      />
    )
  }

  // ── 考生选择考试 ──
  if (view === 'candidate-select' && auth) {
    return (
      <ExamSelectPage
        candidateName={auth.user.real_name}
        exams={candidateExams}
        submittedExamId={candidateSession?.status === 'Completed' ? candidateSession.exam_id : undefined}
        activeSession={candidateSession ?? null}
        onSelect={handleExamSelect}
        onResumeExam={() => setView('candidate-exam')}
        onLogout={logout}
        error={pageError}
      />
    )
  }

  // ── 考生人脸验证 ──
  if (view === 'candidate-verify' && exam && candidateSession && auth) {
    return (
      <VerificationPage
        exam={exam}
        candidateName={candidateSession.candidate_name}
        referencePhoto={auth.user.reference_photo}
        onBack={() => setView('candidate-select')}
        onVerify={verifyCandidateIdentity}
        onEnterExam={activateCandidateSession}
        verified={candidateSession.auth_records.some(
          (r) => r.method === 'Initial Face Verification' && r.status === 'Passed',
        )}
        error={pageError}
        onDismissError={() => setPageError('')}
      />
    )
  }

  // ── 考生考试主界面 ──
  if (view === 'candidate-exam' && exam && candidateSession && config) {
    return (
      <CandidateExam
        exam={exam}
        session={candidateSession}
        questions={candidateQuestions}
        answers={candidateAnswers}
        config={config}
        referencePhoto={auth?.user.reference_photo ?? null}
        pageError={pageError}
        onAnswerChange={handleAnswerChange}
        onRiskEvent={reportRiskEvent}
        onSubmit={submitExam}
        onBackToDashboard={() => setView('candidate-select')}
        onVerifyStepUpFace={verifyStepUpFace}
        onCompleteStepUp={completeStepUp}
        onDismissError={() => setPageError('')}
      />
    )
  }

  // ── 考生考试结果页 ──
  if (view === 'candidate-result' && candidateResult && exam && candidateSession) {
    return (
      <ResultPage
        result={candidateResult}
        session={candidateSession}
        exam={exam}
        onReturnHome={returnToDashboardAfterExam}
      />
    )
  }

  // ── 监考员登录页 ──
  if (view === 'proctor-login') {
    return (
      <LoginPortal
        variant="proctor"
        title="Invigilator Sign In"
        description="Sign in to the invigilation dashboard."
        hint="Contact your administrator for login credentials."
        onBack={() => setView('landing')}
        onSubmit={(u, p) => handleLogin(u, p, 'proctor')}
        error={pageError}
      />
    )
  }

  // ── 监考员仪表盘 ──
  if (view === 'proctor-dashboard' && proctorData) {
    return (
      <ProctorDashboardV2
        data={proctorData}
        selectedSession={activeSelectedSession}
        onSelectSession={setSelectedSessionId}
        onSendNotice={sendProctorNotice}
        onFreeze={freezeSession}
        onUnfreeze={unfreezeSession}
        onClearSnapshot={clearSessionSnapshot}
        onDeleteEvent={deleteRiskEvent}
        onLogout={logout}
        pageError={pageError}
        onDismissError={() => setPageError('')}
      />
    )
  }

  // ── 管理员登录页 ──
  if (view === 'admin-login') {
    return (
      <LoginPortal
        variant="admin"
        title="Administrator Sign In"
        description="Sign in to manage users, exams, and settings."
        hint="Contact your administrator for login credentials."
        onBack={() => setView('landing')}
        onSubmit={(u, p) => handleLogin(u, p, 'admin')}
        error={pageError}
      />
    )
  }

  // ── 管理员题目管理页 ──
  if (auth?.user.role === 'admin' && view === 'admin-questions' && questionExam) {
    return (
      <div className="shell-layout">
        <aside className="shell-sidebar">
          <div className="shell-brand"><strong>RA-MFA</strong><span>Admin Console</span></div>
          <button className="shell-link" onClick={() => setView('admin-config')}>Monitoring Rules</button>
          <button className="shell-link" onClick={() => setView('admin-users')}>User Management</button>
          <button className="shell-link shell-link-active" onClick={() => setView('admin-exams')}>Exam Management</button>
        </aside>
        <div className="shell-main">
          <header className="shell-header">
            <h1>Question Management — {questionExam.title}</h1>
            <div className="shell-header-actions">
              <span>{auth.user.username}</span>
              <button className="secondary-button" onClick={() => void logout()}>Logout</button>
            </div>
          </header>
          <QuestionEditor
            exam={questionExam}
            questions={adminQuestions}
            onSave={saveQuestion}
            onDelete={deleteQuestion}
            onBack={() => setView('admin-exams')}
          />
        </div>
      </div>
    )
  }

  // ── 管理员控制台 ──
  if (auth?.user.role === 'admin' && config &&
      (view === 'admin-config' || view === 'admin-users' || view === 'admin-exams')) {
    return (
      <AdminPanel
        currentUser={auth.user}
        config={config}
        users={adminUsers}
        exams={adminExams}
        view={view}
        userForm={userForm}
        examForm={examForm}
        onChangeView={setView}
        onConfigSave={saveConfig}
        onUserFormChange={setUserForm}
        onExamFormChange={setExamForm}
        onSaveUser={saveUser}
        onToggleUserStatus={toggleUserStatus}
        onSaveExam={saveExam}
        onDeleteExam={removeExam}
        onResetSessions={resetExamSessions}
        onManageQuestions={manageQuestions}
        onLogout={logout}
      />
    )
  }

  // ── 默认：首页 ──
  return (
    <LandingPage
      onCandidate={() => { setPageError(''); setView('candidate-login') }}
      onProctor={() => { setPageError(''); setView('proctor-login') }}
      onAdmin={() => { setPageError(''); setView('admin-login') }}
    />
  )
}

export default App
