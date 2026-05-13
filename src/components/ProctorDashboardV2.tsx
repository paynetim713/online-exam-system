/**
 * ProctorDashboardV2.tsx — 监考员工作台
 *
 * 包含两个组件：
 *  - ProctorDashboardV2：主仪表盘，含四个标签页：
 *      Overview（总览）/ Risk Alerts（风险警报）/ Session Review（会话详情）/ Incident History（历史记录）
 *  - ProctorSessionDetailCard：右侧会话详情卡片（所有标签页共用）
 *
 * 删除操作（删除监控帧、删除风险事件）均直接用后端返回的 session 对象更新
 * 前端状态，不做完整刷新，确保操作即时生效。
 */

import { useState } from 'react'
import type { CandidateSession, ExamRecord, ProctorDashboardData } from '../types'
import { formatCompactTime, formatDate, getRiskTone } from '../utils'
import { MetricCard } from './MetricCard'

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 标签页标识符 */
type ProctorWorkspaceTab = 'overview' | 'alerts' | 'review' | 'history'

/** 发送给考生的默认通知文本 */
const DEFAULT_NOTICE = 'Please stay focused on your exam window and continue the exam independently.'

function formatRiskTrigger(trigger: string) {
  return trigger.replaceAll('_', ' ')
}

// ─────────────────────────────────────────────
// ProctorSessionDetailCard — 右侧会话详情卡片
// ─────────────────────────────────────────────

interface DetailCardProps {
  selectedSession: CandidateSession | null
  notice: string
  onNoticeChange: (value: string) => void
  onSendNotice: (sessionId: string, message: string) => Promise<void> | void
  onFreeze: (sessionId: string) => Promise<void> | void
  onUnfreeze: (sessionId: string) => Promise<void> | void
  /** 删除最新监控帧截图 */
  onClearSnapshot: (sessionId: string) => Promise<void> | void
  /** 删除单条风险事件记录 */
  onDeleteEvent: (sessionId: string, eventId: string) => Promise<void> | void
}

/**
 * 会话详情卡片
 * 显示单个考生的实时快照、风险记录、验证历史，以及监考员操作按钮。
 */
export function ProctorSessionDetailCard({
  selectedSession,
  notice,
  onNoticeChange,
  onSendNotice,
  onFreeze,
  onUnfreeze,
  onClearSnapshot,
  onDeleteEvent,
}: DetailCardProps) {
  // 未选中会话时显示空状态
  if (!selectedSession) {
    return (
      <section className="dashboard-panel detail-panel">
        <div className="empty-state">No session selected.</div>
      </section>
    )
  }

  return (
    <section className="dashboard-panel detail-panel">
      {/* 标题：考生姓名 + 风险等级标签 */}
      <div className="panel-heading">
        <h3>{selectedSession.candidate_name}</h3>
        <span className={`risk-pill risk-pill-${getRiskTone(selectedSession.risk_level)}`}>
          {selectedSession.risk_score}
        </span>
      </div>

      {/* 核心指标：状态、综合风险、行为风险、环境风险 */}
      <div className="detail-grid">
        <MetricCard label="Status" value={selectedSession.status} compact />
        <MetricCard label="Composite Risk" value={String(selectedSession.risk_score)} compact />
        <MetricCard label="Behaviour Risk" value={String(selectedSession.session_score)} compact />
        <MetricCard label="Environment Risk" value={String(selectedSession.context_score)} compact />
      </div>

      {/* 会话快照：答题进度、当前题号、剩余时间、最后活跃时间 */}
      <div className="detail-box">
        <strong>Session Snapshot</strong>
        <div className="status-grid">
          <div className="status-item">
            <span>Answered</span>
            <strong>{`${selectedSession.answer_count}/${selectedSession.total_questions}`}</strong>
          </div>
          <div className="status-item">
            <span>Current Question</span>
            <strong>{selectedSession.current_question}</strong>
          </div>
          <div className="status-item">
            <span>Time Remaining</span>
            <strong>{formatCompactTime(selectedSession.remaining_seconds)}</strong>
          </div>
          <div className="status-item">
            <span>Last Activity</span>
            <strong>{formatDate(selectedSession.last_activity)}</strong>
          </div>
        </div>
      </div>

      {/* Latest verification snapshot */}
      <div className="detail-box">
        <div className="detail-box-header">
          <strong>Latest Verification Snapshot</strong>
          {selectedSession.latest_snapshot && (
            <button
              className="clear-snapshot-btn"
              onClick={() => void onClearSnapshot(selectedSession.id)}
              title="Delete this snapshot"
            >
              Delete Snapshot
            </button>
          )}
        </div>
        {selectedSession.latest_snapshot ? (
          <img src={selectedSession.latest_snapshot} alt="Latest verification snapshot" className="proctor-snapshot" />
        ) : (
          <div className="empty-state">No verification snapshot has been recorded yet.</div>
        )}
        <span>Last updated: {formatDate(selectedSession.latest_snapshot_at)}</span>
      </div>

      {/* 风险记录列表（每条可单独删除） */}
      <div className="detail-box">
        <strong>Risk Records</strong>
        {selectedSession.risk_events.length === 0 && (
          <div className="empty-state">No incident is attached to this session yet.</div>
        )}
        {selectedSession.risk_events.slice(0, 6).map((event) => (
          <div key={event.id} className="detail-row detail-row-stack">
            <div className="detail-box-header">
              <span>{event.label}</span>
              <button
                className="clear-snapshot-btn"
                onClick={() => void onDeleteEvent(selectedSession.id, event.id)}
                title="Delete this event"
              >
                Delete
              </button>
            </div>
            <small>{`${formatDate(event.occurred_at)} | ${event.note}`}</small>
          </div>
        ))}
      </div>

      {/* 验证历史记录（人脸验证、OTP 等） */}
      <div className="detail-box">
        <strong>Risk Score Trend</strong>
        {selectedSession.risk_history.length === 0 && (
          <div className="empty-state">No risk-score history is available yet.</div>
        )}
        {selectedSession.risk_history.slice(0, 6).map((record) => (
          <div key={record.id} className="detail-row detail-row-stack">
            <div className="detail-box-header">
              <span>{formatDate(record.recorded_at)}</span>
              <strong>{record.risk_score}</strong>
            </div>
            <div className="progress-line">
              <div className="progress-fill" style={{ width: `${record.risk_score}%` }} />
            </div>
            <small>
              {`${record.risk_level} | Behaviour ${record.session_score} | Context ${record.context_score}`}
            </small>
            <small>{formatRiskTrigger(record.trigger)}</small>
          </div>
        ))}
      </div>

      <div className="detail-box">
        <strong>Verification History</strong>
        {selectedSession.auth_records.length === 0 && (
          <div className="empty-state">No verification checkpoint has been recorded yet.</div>
        )}
        {selectedSession.auth_records.slice(0, 4).map((record) => (
          <div key={record.id} className="detail-row detail-row-stack">
            <span>{record.method}</span>
            <small>{`${record.status} | ${formatDate(record.occurred_at)}`}</small>
          </div>
        ))}
      </div>

      {/* 监考员操作区：发送通知、冻结/解冻会话 */}
      <div className="detail-box">
        <strong>Invigilator Actions</strong>
        <textarea
          className="notice-input"
          value={notice}
          onChange={(e) => onNoticeChange(e.target.value)}
          placeholder="Write a short notice to the candidate"
        />
        <div className="detail-actions">
          <button
            className="secondary-button"
            onClick={() => void onSendNotice(selectedSession.id, notice)}
            disabled={notice.trim() === ''}  // 空内容禁止发送
          >
            Send Notice
          </button>
          <button
            className="danger-button"
            onClick={() => void onFreeze(selectedSession.id)}
            disabled={selectedSession.frozen}   // 已冻结时禁用
          >
            Freeze Session
          </button>
          <button
            className="primary-button"
            onClick={() => void onUnfreeze(selectedSession.id)}
            disabled={!selectedSession.frozen}  // 未冻结时禁用
          >
            Unfreeze
          </button>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────
// ProctorDashboardV2 — 监考员主仪表盘
// ─────────────────────────────────────────────

interface ProctorDashboardV2Props {
  data: ProctorDashboardData
  selectedSession: CandidateSession | null
  onSelectSession: (sessionId: string) => void
  onSendNotice: (sessionId: string, message: string) => Promise<void> | void
  onFreeze: (sessionId: string) => Promise<void> | void
  onUnfreeze: (sessionId: string) => Promise<void> | void
  onClearSnapshot: (sessionId: string) => Promise<void> | void
  onDeleteEvent: (sessionId: string, eventId: string) => Promise<void> | void
  onLogout: () => Promise<void> | void
  pageError: string          // 操作失败时的错误信息（来自 App.tsx）
  onDismissError: () => void // 关闭错误提示
}

export function ProctorDashboardV2({
  data,
  selectedSession,
  onSelectSession,
  onSendNotice,
  onFreeze,
  onUnfreeze,
  onClearSnapshot,
  onDeleteEvent,
  onLogout,
  pageError,
  onDismissError,
}: ProctorDashboardV2Props) {
  // 每个会话的通知草稿（以 sessionId 为 key 独立保存）
  const [noticeDrafts, setNoticeDrafts] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<ProctorWorkspaceTab>('overview')
  // 考试过滤器：null = 显示所有考试，否则只显示该 exam_id 的会话
  const [filterExamId, setFilterExamId] = useState<string | null>(null)

  // 获取 exams 列表（兼容旧版只有 exam 的数据结构）
  const exams: ExamRecord[] = data.exams?.length ? data.exams : [data.exam]
  // 构建 exam_id → ExamRecord 的映射，用于在会话卡片上显示考试名称
  const examMap = new Map(exams.map((e) => [e.id, e]))

  // 按考试过滤后的会话列表
  const visibleSessions = filterExamId
    ? data.sessions.filter((s) => s.exam_id === filterExamId)
    : data.sessions

  // 当前选中会话的通知文本（优先使用草稿，其次用已发送通知，最后用默认文本）
  const notice =
    selectedSession === null
      ? DEFAULT_NOTICE
      : noticeDrafts[selectedSession.id] ?? selectedSession.proctor_notice ?? DEFAULT_NOTICE

  // 需要关注的会话（风险 ≥ Medium、被标记、被冻结、待验证、或有通知）
  const alertSessions = visibleSessions.filter(
    (s) => s.risk_level !== 'Low' || s.flagged || s.frozen || s.verification_required || Boolean(s.proctor_notice),
  )

  // 所有可见会话的风险事件合并并按时间倒序（用于历史标签页）
  const incidentHistory = visibleSessions
    .flatMap((s) => s.risk_events.map((e) => ({ ...e, session_id: s.id, candidate_name: s.candidate_name })))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  // 所有可见会话的身份验证记录合并并按时间倒序
  const verificationHistory = visibleSessions
    .flatMap((s) => s.auth_records.map((r) => ({ ...r, candidate_name: s.candidate_name })))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  const riskHistory = visibleSessions
    .flatMap((s) => s.risk_history.map((r) => ({ ...r, candidate_name: s.candidate_name })))
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))

  /** 发送通知后清空该会话的草稿框 */
  async function handleSendNotice(sid: string, msg: string) {
    await onSendNotice(sid, msg)
    if (selectedSession) setNoticeDrafts((cur) => ({ ...cur, [selectedSession.id]: '' }))
  }

  /** 更新指定会话的通知草稿 */
  function handleNoticeChange(value: string) {
    if (!selectedSession) return
    setNoticeDrafts((cur) => ({ ...cur, [selectedSession.id]: value }))
  }

  // 三个标签页均使用同一个 ProctorSessionDetailCard，集中管理属性避免重复
  const detailCardProps = {
    selectedSession,
    notice,
    onNoticeChange: handleNoticeChange,
    onSendNotice: handleSendNotice,
    onFreeze,
    onUnfreeze,
    onClearSnapshot,
    onDeleteEvent,
  }

  return (
    <div className="shell-layout">
      {/* 左侧导航栏 */}
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <strong>RA-MFA</strong>
          <span>Invigilator Portal</span>
        </div>
        {(['overview', 'alerts', 'review', 'history'] as ProctorWorkspaceTab[]).map((tab) => (
          <button
            key={tab}
            className={`shell-link ${activeTab === tab ? 'shell-link-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' && 'Monitoring Dashboard'}
            {tab === 'alerts' && 'Risk Alerts'}
            {tab === 'review' && 'Session Review'}
            {tab === 'history' && 'Incident History'}
          </button>
        ))}
      </aside>

      <div className="shell-main">
        {/* 顶部标题栏 */}
        <header className="shell-header">
          <h1>Invigilator Console</h1>
          <div className="shell-header-actions">
            <span>{exams.length} exam{exams.length !== 1 ? 's' : ''} active</span>
            <button className="secondary-button" onClick={() => void onLogout()}>Logout</button>
          </div>
        </header>

        {/* 操作失败时显示错误条（可关闭） */}
        {pageError && (
          <div className="top-notice">
            <span>{pageError}</span>
            <button className="text-link" onClick={onDismissError}>Dismiss</button>
          </div>
        )}

        {/* 考试过滤器（多考试时显示选项卡） */}
        {exams.length > 0 && (
          <div className="exam-filter-bar">
            <button
              className={`exam-filter-tab ${filterExamId === null ? 'exam-filter-tab-active' : ''}`}
              onClick={() => setFilterExamId(null)}
            >
              All Exams
              <span className="exam-filter-count">{data.sessions.length}</span>
            </button>
            {exams.map((ex) => {
              const count = data.sessions.filter((s) => s.exam_id === ex.id).length
              return (
                <button
                  key={ex.id}
                  className={`exam-filter-tab ${filterExamId === ex.id ? 'exam-filter-tab-active' : ''}`}
                  onClick={() => setFilterExamId(ex.id)}
                >
                  {ex.title}
                  <span className="exam-filter-count">{count}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* 考试概览横幅 */}
        <section className="dashboard-hero">
          <div>
            <span className="eyebrow">Live supervision</span>
            <h2>
              {filterExamId
                ? (examMap.get(filterExamId)?.title ?? 'Unknown Exam')
                : exams.map((e) => e.subject).join(' · ')}
            </h2>
            <p>Review sessions and intervene when required.</p>
          </div>
          <div>
            <div className="hero-timer">{formatCompactTime(selectedSession?.remaining_seconds ?? 0)}</div>
            <div className="hero-timer-label">Time Remaining</div>
          </div>
        </section>

        {/* 顶部四格汇总指标（随过滤器动态变化） */}
        <div className="metric-grid">
          <MetricCard label="Total Students" value={String(visibleSessions.length)} />
          <MetricCard label="Active" value={String(visibleSessions.filter((s) => ['Active', 'Verification', 'Flagged', 'Idle'].includes(s.status)).length)} />
          <MetricCard label="Completed" value={String(visibleSessions.filter((s) => s.status === 'Completed').length)} />
          <MetricCard label="Flagged" value={String(visibleSessions.filter((s) => s.flagged || s.risk_level === 'High').length)} />
        </div>

        {/* ── 标签页：总览 ── */}
        {activeTab === 'overview' && (
          <div className="dashboard-grid">
            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Candidate Sessions</h3>
                <span className="panel-caption">Live queue</span>
              </div>
              <div className="session-grid">
                {visibleSessions.map((s) => (
                  <button
                    key={s.id}
                    className={`session-card ${selectedSession?.id === s.id ? 'session-card-active' : ''}`}
                    onClick={() => onSelectSession(s.id)}
                  >
                    <div className="session-card-head">
                      <div className="avatar-circle">{s.candidate_name.slice(0, 1)}</div>
                      <div className="session-card-meta">
                        <strong>{s.candidate_name}</strong>
                        <span>{s.status}</span>
                      </div>
                      <span className={`risk-pill risk-pill-${getRiskTone(s.risk_level)}`}>{s.risk_level}</span>
                    </div>
                    <div className="session-card-body">
                      <span>Question {s.current_question}/{s.total_questions}</span>
                      <div className="mini-progress">
                        <div style={{ width: `${s.progress}%` }} />
                      </div>
                      <small>{s.monitoring_status}</small>
                    </div>
                    {/* 多考试时在卡片底部显示考试名称 */}
                    {exams.length > 1 && (
                      <div className="session-card-exam">{examMap.get(s.exam_id)?.title ?? s.exam_id}</div>
                    )}
                  </button>
                ))}
              </div>
            </section>
            <ProctorSessionDetailCard {...detailCardProps} />
          </div>
        )}

        {/* ── 标签页：风险警报 ── */}
        {activeTab === 'alerts' && (
          <div className="dashboard-grid">
            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Priority Alerts</h3>
                <span className="panel-caption">{alertSessions.length} sessions require attention</span>
              </div>
              {alertSessions.length === 0 && (
                <div className="empty-state">No medium or high-risk session is waiting for action.</div>
              )}
              <div className="alert-list">
                {alertSessions.map((s) => {
                  const latestEvent = s.risk_events[0]
                  return (
                    <div key={s.id} className="alert-card">
                      <div className="alert-card-head">
                        <div>
                          <strong>{s.candidate_name}</strong>
                          <span>{s.monitoring_status}</span>
                        </div>
                        <span className={`risk-pill risk-pill-${getRiskTone(s.risk_level)}`}>{s.risk_level}</span>
                      </div>
                      <div className="alert-card-meta">
                        <span>{`Risk ${s.risk_score} | ${s.answer_count}/${s.total_questions} answered`}</span>
                        <span>{latestEvent ? latestEvent.label : 'No event details yet'}</span>
                      </div>
                      <div className="detail-actions">
                        {/* 跳转到该会话的详情 Review 标签 */}
                        <button
                          className="table-button"
                          onClick={() => { onSelectSession(s.id); setActiveTab('review') }}
                        >
                          Open Review
                        </button>
                        <button className="table-button" onClick={() => void onSendNotice(s.id, DEFAULT_NOTICE)}>
                          Send Reminder
                        </button>
                        {s.frozen ? (
                          <button className="primary-button" onClick={() => void onUnfreeze(s.id)}>Unfreeze</button>
                        ) : (
                          <button className="secondary-button" onClick={() => void onFreeze(s.id)}>Freeze</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <ProctorSessionDetailCard {...detailCardProps} />
          </div>
        )}

        {/* ── 标签页：会话审阅 ── */}
        {activeTab === 'review' && (
          <div className="dashboard-grid">
            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Review Queue</h3>
                <span className="panel-caption">Select a candidate to inspect activity</span>
              </div>
              <div className="review-list">
                {visibleSessions.map((s) => (
                  <button
                    key={s.id}
                    className={`review-row ${selectedSession?.id === s.id ? 'review-row-active' : ''}`}
                    onClick={() => onSelectSession(s.id)}
                  >
                    <div>
                      <strong>{s.candidate_name}</strong>
                      <span>{`${s.status} | ${s.monitoring_status}`}</span>
                      {exams.length > 1 && (
                        <span className="review-row-exam">{examMap.get(s.exam_id)?.title ?? s.exam_id}</span>
                      )}
                    </div>
                    <div className="review-row-meta">
                      <span>{`${s.answer_count}/${s.total_questions}`}</span>
                      <span className={`risk-pill risk-pill-${getRiskTone(s.risk_level)}`}>{s.risk_score}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <ProctorSessionDetailCard {...detailCardProps} />
          </div>
        )}

        {/* ── 标签页：历史记录 ── */}
        {activeTab === 'history' && (
          <div className="history-layout">
            {/* 风险事件时间线（每条可单独删除） */}
            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Incident Timeline</h3>
                <span className="panel-caption">Captured monitoring events</span>
              </div>
              <div className="history-feed">
                {incidentHistory.length === 0 && (
                  <div className="empty-state">No incident has been recorded yet.</div>
                )}
                {incidentHistory.slice(0, 18).map((event) => (
                  <div key={event.id} className="history-item">
                    <div>
                      <strong>{event.label}</strong>
                      <span>{`${event.candidate_name} | ${formatDate(event.occurred_at)}`}</span>
                    </div>
                    <p>{event.note}</p>
                    <button
                      className="clear-snapshot-btn"
                      onClick={() => void onDeleteEvent(event.session_id, event.id)}
                      title="Delete this event"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* 身份验证时间线（仅展示，不可删除） */}
            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Verification Timeline</h3>
                <span className="panel-caption">Identity and step-up records</span>
              </div>
              <div className="history-feed">
                {verificationHistory.length === 0 && (
                  <div className="empty-state">No verification activity has been recorded yet.</div>
                )}
                {verificationHistory.slice(0, 18).map((record) => (
                  <div key={record.id} className="history-item">
                    <div>
                      <strong>{record.method}</strong>
                      <span>{`${record.candidate_name} | ${formatDate(record.occurred_at)}`}</span>
                    </div>
                    <p>{`${record.status} via ${record.triggered_by}`}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="dashboard-panel">
              <div className="panel-heading">
                <h3>Risk Score Timeline</h3>
                <span className="panel-caption">Recalculated score history</span>
              </div>
              <div className="history-feed">
                {riskHistory.length === 0 && (
                  <div className="empty-state">No risk-score history has been recorded yet.</div>
                )}
                {riskHistory.slice(0, 18).map((record) => (
                  <div key={record.id} className="history-item">
                    <div>
                      <strong>{`${record.risk_score} (${record.risk_level})`}</strong>
                      <span>{`${record.candidate_name} | ${formatDate(record.recorded_at)}`}</span>
                    </div>
                    <p>
                      {`${formatRiskTrigger(record.trigger)} | Behaviour ${record.session_score} | Context ${record.context_score}`}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
