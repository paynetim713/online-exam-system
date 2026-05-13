/**
 * ExamSelectPage.tsx — 考生考试选择页（重设计版）
 *
 * 设计特点：
 *  - 深色沉浸式背景 + 顶部彩色光晕（与 Landing 风格统一）
 *  - 考试卡片大图标 + 清晰状态标签
 *  - submitted / upcoming / available 三种状态视觉区分
 */

import { useState } from 'react'
import type { CandidateSession, ExamRecord } from '../types'

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface ExamSelectPageProps {
  candidateName: string
  exams: ExamRecord[]
  submittedExamId?: string
  activeSession: CandidateSession | null
  onSelect: (examId: string) => Promise<void>
  onResumeExam: () => void
  onLogout: () => void
  error: string
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
}

function fmtDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

// ─────────────────────────────────────────────
// 单张考试卡片
// ─────────────────────────────────────────────

type CardState = 'submitted' | 'upcoming' | 'available'

function ExamCard({
  exam,
  state,
  busy,
  onPick,
}: {
  exam: ExamRecord
  state: CardState
  busy: boolean
  onPick: () => void
}) {
  const icon =
    state === 'submitted' ? '✓' :
    state === 'upcoming'  ? '◷' : '▷'

  return (
    <div
      className={`exc-card exc-card-${state} ${state === 'available' && !busy ? 'exc-card-clickable' : ''}`}
      onClick={state === 'available' && !busy ? onPick : undefined}
      role={state === 'available' ? 'button' : undefined}
      tabIndex={state === 'available' && !busy ? 0 : undefined}
      onKeyDown={state === 'available' && !busy ? (e) => e.key === 'Enter' && onPick() : undefined}
    >
      {/* 左侧图标区 */}
      <div className="exc-card-icon-wrap">
        <span className="exc-card-icon">{icon}</span>
      </div>

      {/* 中间信息区 */}
      <div className="exc-card-body">
        <div className="exc-card-title">{exam.title}</div>
        <div className="exc-card-meta">
          <span>{exam.subject}</span>
          <span className="exc-meta-dot">·</span>
          <span>{fmtDate(exam.start_time)}</span>
          <span className="exc-meta-dot">·</span>
          <span>{fmtDuration(exam.duration_seconds)}</span>
          <span className="exc-meta-dot">·</span>
          <span>{exam.total_questions} questions</span>
        </div>
      </div>

      {/* 右侧状态区 */}
      <div className="exc-card-right">
        {state === 'submitted' && <span className="exc-badge exc-badge-submitted">Submitted</span>}
        {state === 'upcoming'  && <span className="exc-badge exc-badge-upcoming">Upcoming</span>}
        {state === 'available' && !busy && <span className="exc-arrow">→</span>}
        {state === 'available' && busy  && <span className="exc-loading" />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export function ExamSelectPage({
  candidateName,
  exams,
  submittedExamId,
  activeSession,
  onSelect,
  onResumeExam,
  onLogout,
  error,
}: ExamSelectPageProps) {
  const [busy, setBusy] = useState(false)
  const [pickingId, setPickingId] = useState<string | null>(null)

  const isFrozen  = activeSession?.frozen === true
  const isActive  = !isFrozen && activeSession != null &&
    (activeSession.status === 'Active' || activeSession.status === 'Flagged' ||
     (activeSession.status === 'Verification' && activeSession.verification_required))
  const isBlocked = isFrozen || isActive

  async function handlePick(examId: string) {
    if (isBlocked) return
    setBusy(true)
    setPickingId(examId)
    await onSelect(examId)
    setBusy(false)
    setPickingId(null)
  }

  const available = exams.filter((e) => e.status === 'Active' && !e.submitted && e.id !== submittedExamId)
  const submitted  = exams.filter((e) => e.submitted || e.id === submittedExamId)
  const upcoming   = exams.filter((e) => e.status !== 'Active' && !e.submitted && e.id !== submittedExamId)

  return (
    <div className="exc-root">

      {/* 背景光晕 */}
      <div className="exc-bg" aria-hidden>
        <div className="exc-orb exc-orb-1" />
        <div className="exc-orb exc-orb-2" />
      </div>

      {/* 顶部导航 */}
      <header className="exc-nav">
        <div className="exc-nav-brand">RA·MFA</div>
        <div className="exc-nav-right">
          <span className="exc-nav-user">{candidateName}</span>
          <button className="exc-nav-logout" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      {/* 主内容卡片 */}
      <main className="exc-main">
        <div className="exc-panel">

          {/* 标题区 */}
          <div className="exc-panel-head">
            <div className="exc-panel-title">Select Your Exam</div>
            <div className="exc-panel-sub">Choose the examination you are scheduled to sit today.</div>
          </div>

          {/* 冻结/活跃会话提示 */}
          {isFrozen && (
            <div className="exc-session-notice exc-session-notice-frozen">
              <strong>Session Suspended</strong>
              <p>Your exam session has been suspended by the invigilator. You cannot enter the exam until a proctor reviews and lifts the suspension. Please remain available and contact your invigilator.</p>
            </div>
          )}
          {isActive && (
            <div className="exc-session-notice exc-session-notice-active">
              <strong>Exam In Progress</strong>
              <p>You have an active exam session. Return to continue where you left off.</p>
              <button className="primary-button" onClick={onResumeExam}>Return to Exam</button>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="exc-error">{error}</div>
          )}

          {/* 考试列表 */}
          <div className="exc-list">
            {exams.length === 0 ? (
              <div className="exc-empty">No examinations are currently scheduled for your account.</div>
            ) : (
              <>
                {/* 可进入的考试 */}
                {available.map((ex) => (
                  <ExamCard
                    key={ex.id}
                    exam={ex}
                    state={isBlocked ? 'upcoming' : 'available'}
                    busy={busy && pickingId === ex.id}
                    onPick={() => void handlePick(ex.id)}
                  />
                ))}

                {/* 即将开始 */}
                {upcoming.map((ex) => (
                  <ExamCard key={ex.id} exam={ex} state="upcoming" busy={false} onPick={() => {}} />
                ))}

                {/* 已提交 */}
                {submitted.map((ex) => (
                  <ExamCard key={ex.id} exam={ex} state="submitted" busy={false} onPick={() => {}} />
                ))}
              </>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
