/**
 * ResultPage.tsx — 考试结果页
 * 考生提交答卷后显示此页，展示风险评分、答题情况和关键监控事件。
 * 成绩具体分值由后端在 release_at 时间后公布，此处仅显示监控结论。
 */

import type { CandidateSession, ExamRecord, SubmitResult } from '../types'
import { formatDate } from '../utils'
import { MetricCard } from './MetricCard'

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface ResultPageProps {
  result: SubmitResult           // 提交结果摘要（风险分、答题数等）
  session: CandidateSession      // 考生当前会话（用于展示风险事件记录）
  exam: ExamRecord               // 考试信息
  onReturnHome: () => Promise<void> | void  // 返回首页（触发退出登录）
}

// ─────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────

export function ResultPage({ result, session, exam, onReturnHome }: ResultPageProps) {
  return (
    <div className="result-page">
      <div className="result-card">
        <span className="eyebrow">Submission complete</span>
        <h1>Exam submitted successfully</h1>
        <p>
          <strong>{exam.title}</strong> responses saved. Score release: {formatDate(result.release_at)}.
        </p>

        {/* 核心指标：答题数、风险分、风险等级、加验次数 */}
        <div className="result-grid">
          <MetricCard label="Answered" value={`${result.answered}/${result.total_questions}`} />
          <MetricCard label="Risk Score" value={String(result.risk_score)} />
          <MetricCard label="Risk Level" value={result.risk_level} />
          <MetricCard label="Step-Up Count" value={String(result.reauth_count)} />
        </div>

        {/* 若会话被标记为可疑，显示人工复核提醒 */}
        {result.flagged && (
          <div className="inline-alert inline-alert-warning">
            This session has been marked for manual review due to elevated monitoring risk.
          </div>
        )}

        {/* 最近风险事件时间线（最多展示 4 条） */}
        <div className="result-timeline">
          <h3>Session Summary</h3>
          {session.risk_events.slice(0, 4).map((event) => (
            <div key={event.id} className="risk-log-item">
              <strong>{event.label}</strong>
              <span>{event.note}</span>
            </div>
          ))}
        </div>

        <button className="primary-button" onClick={() => void onReturnHome()}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
