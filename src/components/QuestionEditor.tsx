/**
 * QuestionEditor.tsx — 题目管理页面
 *
 * 管理员在此页面为指定考试新增、编辑、删除题目。
 * 支持四种题型：单选（mcq）、判断（truefalse）、问答（textarea）、简答（short）。
 */

import { useState } from 'react'
import type { ExamRecord, QuestionOption, QuestionRecord } from '../types'

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface QuestionEditorProps {
  exam: ExamRecord                                                          // 当前编辑的考试
  questions: QuestionRecord[]                                               // 该考试已有题目列表
  onSave: (q: QuestionRecord & { exam_id: string }) => Promise<void> | void // 保存（新建或更新）
  onDelete: (questionId: string) => Promise<void> | void                    // 删除题目
  onBack: () => void                                                        // 返回考试列表
}

// ─────────────────────────────────────────────
// 空白题目表单
// ─────────────────────────────────────────────

function emptyForm(examId: string, nextNumber: number): QuestionRecord & { exam_id: string } {
  return {
    id: '',
    exam_id: examId,
    number: nextNumber,
    score: 10,
    type: 'textarea',
    category: 'General',
    prompt: '',
    placeholder: '',
    options: [
      { id: 'a', label: 'A', text: '' },
      { id: 'b', label: 'B', text: '' },
      { id: 'c', label: 'C', text: '' },
      { id: 'd', label: 'D', text: '' },
    ],
  }
}

// ─────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────

export function QuestionEditor({ exam, questions, onSave, onDelete, onBack }: QuestionEditorProps) {
  const [form, setForm] = useState<QuestionRecord & { exam_id: string }>(
    () => emptyForm(exam.id, questions.length + 1),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** 点击"编辑"：将该题数据填入表单 */
  function handleEdit(q: QuestionRecord) {
    // MCQ 题目确保 options 有 4 条
    const options: QuestionOption[] =
      q.type === 'mcq'
        ? [
            q.options[0] ?? { id: 'a', label: 'A', text: '' },
            q.options[1] ?? { id: 'b', label: 'B', text: '' },
            q.options[2] ?? { id: 'c', label: 'C', text: '' },
            q.options[3] ?? { id: 'd', label: 'D', text: '' },
          ]
        : q.options
    setForm({ ...q, exam_id: exam.id, options })
    setError('')
  }

  /** 重置到空白新建状态 */
  function handleReset() {
    setForm(emptyForm(exam.id, questions.length + 1))
    setError('')
  }

  /** 更新选项文字 */
  function setOptionText(idx: number, text: string) {
    setForm((f) => {
      const options = [...f.options]
      options[idx] = { ...options[idx], text }
      return { ...f, options }
    })
  }

  /** 提交保存 */
  async function handleSave() {
    if (!form.prompt.trim()) { setError('Question prompt is required.'); return }
    if (form.type === 'mcq' && form.options.some((o) => !o.text.trim())) {
      setError('All four answer options must be filled in for MCQ questions.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // 非 MCQ 题型清空 options
      const payload = {
        ...form,
        options: form.type === 'mcq' ? form.options : form.type === 'truefalse'
          ? [{ id: 'true', label: 'A', text: 'True' }, { id: 'false', label: 'B', text: 'False' }]
          : [],
      }
      await onSave(payload)
      handleReset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save question.')
    } finally {
      setBusy(false)
    }
  }

  /** 删除题目 */
  async function handleDelete(questionId: string) {
    if (!window.confirm('Delete this question? This cannot be undone.')) return
    setBusy(true)
    try {
      await onDelete(questionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete question.')
    } finally {
      setBusy(false)
    }
  }

  const totalScore = questions.reduce((s, q) => s + q.score, 0)

  return (
    <div className="management-layout">

      {/* 左侧：题目列表 */}
      <section className="dashboard-panel">
        <div className="panel-heading">
          <div>
            <button className="text-link" style={{ marginRight: 12 }} onClick={onBack}>← Back</button>
            <strong>{exam.title}</strong>
          </div>
          <span className="muted-label">{questions.length} questions · {totalScore} pts total</span>
        </div>

        {questions.length === 0 ? (
          <div className="exam-select-empty">No questions yet. Add one using the form on the right.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Type</th><th>Prompt</th><th>Score</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className={form.id === q.id ? 'row-editing' : ''}>
                  <td>{q.number}</td>
                  <td>
                    <span className={`type-pill type-pill-${q.type}`}>
                      {q.type === 'mcq' ? 'MCQ' : q.type === 'truefalse' ? 'T/F' : q.type === 'textarea' ? 'Essay' : 'Short'}
                    </span>
                  </td>
                  <td className="prompt-cell" title={q.prompt}>
                    {q.prompt.length > 60 ? q.prompt.slice(0, 60) + '…' : q.prompt}
                  </td>
                  <td>{q.score}</td>
                  <td>
                    <button className="table-button" onClick={() => handleEdit(q)} disabled={busy}>Edit</button>
                    <button className="table-button table-button-danger" onClick={() => void handleDelete(q.id)} disabled={busy}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 右侧：题目表单 */}
      <section className="dashboard-panel form-panel">
        <div className="panel-heading">
          <h3>{form.id ? `Edit Question #${form.number}` : 'Add Question'}</h3>
        </div>

        {error && (
          <div className="inline-alert inline-alert-danger" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* 题号 + 分值 */}
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Question #
            <input
              type="number" min={1} value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: Number(e.target.value) }))}
            />
          </label>
          <label style={{ flex: 1 }}>
            Score (pts)
            <input
              type="number" min={1} value={form.score}
              onChange={(e) => setForm((f) => ({ ...f, score: Number(e.target.value) }))}
            />
          </label>
        </div>

        {/* 题型 + 类别 */}
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Type
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as QuestionRecord['type'] }))}
            >
              <option value="mcq">MCQ (Single Choice)</option>
              <option value="truefalse">True / False</option>
              <option value="textarea">Essay (Long Answer)</option>
              <option value="short">Short Answer</option>
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Category
            <input
              value={form.category}
              placeholder="e.g. Concept, Analysis"
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </label>
        </div>

        {/* 题目正文 */}
        <label>
          Question Prompt
          <textarea
            rows={4}
            value={form.prompt}
            placeholder="Enter the question text here…"
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
          />
        </label>

        {/* MCQ 选项 */}
        {form.type === 'mcq' && (
          <div className="mcq-options">
            <div className="mcq-options-label">Answer Options</div>
            {form.options.map((opt, idx) => (
              <label key={opt.id} className="mcq-option-row">
                <span className="mcq-option-label">{opt.label}</span>
                <input
                  value={opt.text}
                  placeholder={`Option ${opt.label}`}
                  onChange={(e) => setOptionText(idx, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        {/* 判断题说明 */}
        {form.type === 'truefalse' && (
          <div className="inline-alert inline-alert-info" style={{ marginBottom: 8 }}>
            True / False options (True, False) are generated automatically.
          </div>
        )}

        {/* 简答/问答 提示占位文字 */}
        {(form.type === 'textarea' || form.type === 'short') && (
          <label>
            Answer Placeholder
            <input
              value={form.placeholder}
              placeholder="Optional hint shown inside the answer box"
              onChange={(e) => setForm((f) => ({ ...f, placeholder: e.target.value }))}
            />
          </label>
        )}

        <div className="footer-actions footer-actions-left">
          <button className="secondary-button" onClick={handleReset} disabled={busy}>
            Reset
          </button>
          <button className="primary-button" onClick={() => void handleSave()} disabled={busy}>
            {busy ? 'Saving…' : form.id ? 'Update Question' : 'Add Question'}
          </button>
        </div>
      </section>
    </div>
  )
}
