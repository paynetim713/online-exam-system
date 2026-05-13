/**
 * AdminPanel.tsx — 管理员控制台
 *
 * 包含三个子页面（通过 view 属性切换）：
 *  - admin-config：监控规则配置（阈值、权重、加验方式）
 *  - admin-users：用户管理（创建/编辑用户、上传注册照、启用/禁用账号）
 *  - admin-exams：考试管理（创建/编辑/删除考试）
 */

import { useEffect, useState } from 'react'
import type { ExamRecord, PortalView, RiskConfig, Role, UserRecord } from '../types'
import { formatDate } from '../utils'
import { MetricCard } from './MetricCard'

// ─────────────────────────────────────────────
// 类型：带密码字段的用户表单
// ─────────────────────────────────────────────

export interface EditableUser extends UserRecord {
  password: string        // 新密码（编辑时留空表示不修改）
  reference_photo: string // 注册照 base64（空字符串表示删除）
}

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface AdminPanelProps {
  currentUser: UserRecord
  config: RiskConfig
  users: UserRecord[]
  exams: ExamRecord[]
  view: PortalView          // 当前子页面
  userForm: EditableUser    // 用户表单状态（由父组件持有）
  examForm: ExamRecord      // 考试表单状态（由父组件持有）
  onChangeView: (view: PortalView) => void
  onConfigSave: (config: RiskConfig) => Promise<void> | void
  onUserFormChange: (value: EditableUser) => void
  onExamFormChange: (value: ExamRecord) => void
  onSaveUser: (user: EditableUser) => Promise<void> | void
  onToggleUserStatus: (userId: string) => Promise<void> | void
  onSaveExam: (exam: ExamRecord) => Promise<void> | void
  onDeleteExam: (examId: string) => Promise<void> | void
  onResetSessions: (examId: string) => Promise<void> | void  // 清空该考试的所有会话（发布前）
  onManageQuestions: (exam: ExamRecord) => void               // 点击考试"Questions"按钮
  onLogout: () => Promise<void> | void
}

// ─────────────────────────────────────────────
// 默认配置（与后端 DEFAULT_CONFIG 保持一致）
// ─────────────────────────────────────────────

const DEFAULT_CONFIG: RiskConfig = {
  ws: 0.55,
  wf: 0.45,
  warning_threshold: 35,
  high_risk_threshold: 62,
  idle_timeout_sec: 30,
  suspicious_threshold: 3,
  warning_time_min: 10,
  danger_time_min: 5,
  step_up_method: 'Face Re-Verification',
  updated_at: '',
  session_weights: {
    tab_switch: 22,
    blur_focus: 15,
    fullscreen_exit: 28,
    copy_paste: 26,
    page_refresh: 30,
    repeated_interrupt: 18,
  },
  context_weights: {
    device_change: 28,
    ip_change: 34,
    network_reconnect: 18,
    webcam_interrupt: 20,
  },
  scoring_weights: {
    easy: 20,
    medium: 50,
    hard: 30,
    time_bonus: 10,
    wrong_penalty: 5,
  },
}

// ─────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────

export function AdminPanel({
  currentUser,
  config,
  users,
  exams,
  view,
  userForm,
  examForm,
  onChangeView,
  onConfigSave,
  onUserFormChange,
  onExamFormChange,
  onSaveUser,
  onToggleUserStatus,
  onSaveExam,
  onDeleteExam,
  onResetSessions,
  onManageQuestions,
  onLogout,
}: AdminPanelProps) {
  // 本地草稿配置：在用户点击"保存"前不影响全局配置
  const [draftConfig, setDraftConfig] = useState(config)

  // 顶部统计数字
  const candidateCount = users.filter((u) => u.role === 'candidate').length
  const proctorCount = users.filter((u) => u.role === 'proctor').length
  const activeExamCount = exams.filter((e) => e.status === 'Active').length
  const scheduledExamCount = exams.filter((e) => e.status === 'Scheduled').length

  // 当后端返回新配置（如其他管理员修改后刷新）时同步到本地草稿
  useEffect(() => {
    setDraftConfig(config)
  }, [config])

  return (
    <div className="shell-layout">
      {/* 左侧导航栏 */}
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <strong>RA-MFA</strong>
          <span>Admin Console</span>
        </div>
        <button
          className={`shell-link ${view === 'admin-config' ? 'shell-link-active' : ''}`}
          onClick={() => onChangeView('admin-config')}
        >
          Monitoring Rules
        </button>
        <button
          className={`shell-link ${view === 'admin-users' ? 'shell-link-active' : ''}`}
          onClick={() => onChangeView('admin-users')}
        >
          User Management
        </button>
        <button
          className={`shell-link ${view === 'admin-exams' || view === 'admin-questions' ? 'shell-link-active' : ''}`}
          onClick={() => onChangeView('admin-exams')}
        >
          Exam Management
        </button>
      </aside>

      <div className="shell-main">
        {/* 顶部标题栏 */}
        <header className="shell-header">
          <h1>Platform Administration</h1>
          <div className="shell-header-actions">
            <span>{currentUser.username}</span>
            <button className="secondary-button" onClick={() => void onLogout()}>Logout</button>
          </div>
        </header>

        {/* 顶部统计指标 */}
        <div className="metric-grid">
          <MetricCard label="Candidates" value={String(candidateCount)} />
          <MetricCard label="Invigilators" value={String(proctorCount)} />
          <MetricCard label="Active Exams" value={String(activeExamCount)} />
          <MetricCard label="Scheduled Exams" value={String(scheduledExamCount)} />
        </div>

        {/* ── 子页面：监控规则配置 ── */}
        {view === 'admin-config' && (
          <>
            <section className="dashboard-hero">
              <div>
                <span className="eyebrow">Monitoring policy</span>
                <h2>Monitoring Configuration</h2>
                <p>Adjust the thresholds and weighting rules that drive monitoring alerts, escalation, and invigilator intervention.</p>
              </div>
              <div className="hero-meta">
                <strong>Updated</strong>
                <span>{formatDate(config.updated_at)}</span>
              </div>
            </section>

            <div className="admin-grid">
              {/* 核心阈值 */}
              <section className="admin-card">
                <h3>Core Thresholds</h3>
                <label>
                  Behaviour weight
                  <input
                    type="number" step="0.01"
                    value={draftConfig.ws}
                    onChange={(e) => setDraftConfig((c) => ({
                      ...c,
                      ws: Number(e.target.value),
                      // 两个权重之和固定为 1
                      wf: Number((1 - Number(e.target.value)).toFixed(2)),
                    }))}
                  />
                </label>
                <label>
                  Environment weight
                  <input type="number" step="0.01" value={draftConfig.wf} readOnly />
                </label>
                <label>
                  Warning threshold
                  <input
                    type="number" value={draftConfig.warning_threshold}
                    onChange={(e) => setDraftConfig((c) => ({ ...c, warning_threshold: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  High-risk threshold
                  <input
                    type="number" value={draftConfig.high_risk_threshold}
                    onChange={(e) => setDraftConfig((c) => ({ ...c, high_risk_threshold: Number(e.target.value) }))}
                  />
                </label>
              </section>

              {/* 监控控制参数 */}
              <section className="admin-card">
                <h3>Monitoring Controls</h3>
                <label>
                  Idle timeout (seconds)
                  <input
                    type="number" value={draftConfig.idle_timeout_sec}
                    onChange={(e) => setDraftConfig((c) => ({ ...c, idle_timeout_sec: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Suspicious threshold
                  <input
                    type="number" value={draftConfig.suspicious_threshold}
                    onChange={(e) => setDraftConfig((c) => ({ ...c, suspicious_threshold: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Additional check method
                  <select
                    value={draftConfig.step_up_method}
                    onChange={(e) => setDraftConfig((c) => ({
                      ...c,
                      step_up_method: e.target.value as RiskConfig['step_up_method'],
                    }))}
                  >
                    <option>Face Re-Verification</option>
                    <option>Face + OTP</option>
                  </select>
                </label>
                <div className="formula-box">
                  <strong>Composite Risk Rule</strong>
                  <span className="formula-copy">
                    Overall monitoring risk blends behaviour events with environment changes.
                  </span>
                  <small>
                    Behaviour contribution: {(draftConfig.ws * 100).toFixed(0)}% | Environment contribution:{' '}
                    {(draftConfig.wf * 100).toFixed(0)}%
                  </small>
                  <span>Risk = ws × Session Score + wf × Context Score</span>
                </div>
              </section>

              {/* 行为事件权重（切换标签页时循环渲染） */}
              <section className="admin-card">
                <h3>Behaviour Event Weights</h3>
                {Object.entries(draftConfig.session_weights).map(([key, value]) => (
                  <label key={key}>
                    {key.replaceAll('_', ' ')}
                    <input
                      type="number" value={value}
                      onChange={(e) => setDraftConfig((c) => ({
                        ...c,
                        session_weights: { ...c.session_weights, [key]: Number(e.target.value) },
                      }))}
                    />
                  </label>
                ))}
              </section>

              {/* 环境事件权重 */}
              <section className="admin-card">
                <h3>Environment Event Weights</h3>
                {Object.entries(draftConfig.context_weights).map(([key, value]) => (
                  <label key={key}>
                    {key.replaceAll('_', ' ')}
                    <input
                      type="number" value={value}
                      onChange={(e) => setDraftConfig((c) => ({
                        ...c,
                        context_weights: { ...c.context_weights, [key]: Number(e.target.value) },
                      }))}
                    />
                  </label>
                ))}
              </section>
            </div>

            <div className="footer-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  if (confirm('Restore all settings to factory defaults?')) {
                    setDraftConfig({ ...DEFAULT_CONFIG })
                  }
                }}
              >
                Restore Defaults
              </button>
              <button className="primary-button" onClick={() => void onConfigSave(draftConfig)}>
                Save Configuration
              </button>
            </div>
          </>
        )}

        {/* ── 子页面：用户管理 ── */}
        {view === 'admin-users' && (
          <div className="management-layout">
            {/* 用户列表表格 */}
            <section className="dashboard-panel">
              <div className="panel-heading"><h3>User Management</h3></div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Username</th><th>Role</th><th>Real Name</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.role}</td>
                      <td>{user.real_name}</td>
                      <td>{user.status}</td>
                      <td>
                        {/* 点击编辑时将用户数据填入右侧表单 */}
                        <button
                          className="table-button"
                          onClick={() => onUserFormChange({ ...user, password: '', reference_photo: user.reference_photo ?? '' })}
                        >
                          Edit
                        </button>
                        <button className="table-button" onClick={() => void onToggleUserStatus(user.id)}>
                          {user.status === 'Active' ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 用户创建/编辑表单 */}
            <section className="dashboard-panel form-panel">
              <div className="panel-heading">
                <h3>{userForm.id ? 'Edit User' : 'Create User'}</h3>
              </div>
              <label>
                Username
                <input
                  value={userForm.username}
                  onChange={(e) => onUserFormChange({ ...userForm, username: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  value={userForm.password}
                  onChange={(e) => onUserFormChange({ ...userForm, password: e.target.value })}
                  placeholder={userForm.id ? 'Leave blank to keep the current password' : 'Set a password'}
                />
              </label>
              <label>
                Real Name
                <input
                  value={userForm.real_name}
                  onChange={(e) => onUserFormChange({ ...userForm, real_name: e.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={userForm.role}
                  onChange={(e) => onUserFormChange({ ...userForm, role: e.target.value as Role })}
                >
                  <option value="candidate">candidate</option>
                  <option value="proctor">proctor</option>
                  <option value="admin">admin</option>
                </select>
              </label>

              {/* 注册照上传（仅考生账号需要） */}
              {userForm.role === 'candidate' && (
                <div className="ref-photo-field">
                  <div className="ref-photo-label">
                    Reference Photo
                    <span className="ref-photo-hint">Used for identity verification before the exam</span>
                  </div>
                  {userForm.reference_photo && (
                    <img src={userForm.reference_photo} alt="Reference" className="ref-photo-preview" />
                  )}
                  <label className="ref-photo-upload-btn">
                    {userForm.reference_photo ? 'Replace Photo' : 'Upload Photo'}
                    <input
                      type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = (evt) => {
                          onUserFormChange({ ...userForm, reference_photo: evt.target?.result as string })
                        }
                        reader.readAsDataURL(file)
                      }}
                    />
                  </label>
                  {/* 清除注册照：将 reference_photo 置空（后端识别为删除） */}
                  {userForm.reference_photo && (
                    <button
                      className="ref-photo-clear"
                      onClick={() => onUserFormChange({ ...userForm, reference_photo: '' })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}

              <div className="footer-actions footer-actions-left">
                <button className="secondary-button" onClick={() => onUserFormChange({ id: '', username: '', role: 'candidate', real_name: '', status: 'Active', password: '', reference_photo: '' })}>
                  Reset
                </button>
                <button className="primary-button" onClick={() => void onSaveUser(userForm)}>
                  Save User
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ── 子页面：考试管理 ── */}
        {view === 'admin-exams' && (
          <div className="management-layout">
            {/* 考试列表表格 */}
            <section className="dashboard-panel">
              <div className="panel-heading"><h3>Exam Management</h3></div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Examination</th><th>Start</th><th>End</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map((currentExam) => (
                    <tr key={currentExam.id}>
                      <td>{currentExam.title}</td>
                      <td>{formatDate(currentExam.start_time)}</td>
                      <td>{formatDate(currentExam.end_time)}</td>
                      <td>{currentExam.status}</td>
                      <td>
                        <button className="table-button" onClick={() => onExamFormChange(currentExam)}>Edit</button>
                        <button className="table-button" onClick={() => onManageQuestions(currentExam)}>Questions</button>
                        <button
                          className="table-button"
                          title="Delete all test sessions before distributing to students"
                          onClick={() => {
                            if (window.confirm(`Reset ALL sessions for "${currentExam.title}"?\n\nThis permanently deletes all candidate sessions, risk events, answers, and verification records.\n\nUse this before distributing the exam to students.`)) {
                              void onResetSessions(currentExam.id)
                            }
                          }}
                        >
                          Reset Sessions
                        </button>
                        <button className="table-button table-button-danger" onClick={() => void onDeleteExam(currentExam.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 考试创建/编辑表单 */}
            <section className="dashboard-panel form-panel">
              <div className="panel-heading">
                <h3>{examForm.id ? 'Edit Exam' : 'Create Exam'}</h3>
              </div>
              <label>
                Examination Name
                <input value={examForm.title} onChange={(e) => onExamFormChange({ ...examForm, title: e.target.value })} />
              </label>
              <label>
                Subject
                <input value={examForm.subject} onChange={(e) => onExamFormChange({ ...examForm, subject: e.target.value })} />
              </label>
              <label>
                Start Time
                <input
                  type="datetime-local" value={examForm.start_time}
                  onChange={(e) => onExamFormChange({ ...examForm, start_time: e.target.value })}
                />
              </label>
              <label>
                End Time
                <input
                  type="datetime-local" value={examForm.end_time}
                  onChange={(e) => onExamFormChange({ ...examForm, end_time: e.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={examForm.status}
                  onChange={(e) => onExamFormChange({ ...examForm, status: e.target.value as ExamRecord['status'] })}
                >
                  <option value="Draft">Draft</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Active">Active</option>
                  <option value="Completed">Completed</option>
                </select>
              </label>
              <div className="footer-actions footer-actions-left">
                <button className="secondary-button" onClick={() => onExamFormChange({
                  id: '', title: '', subject: 'Computer Science',
                  start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
                  end_time: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString().slice(0, 16),
                  status: 'Scheduled', total_questions: 20, total_score: 100,
                  candidate_count: 20, duration_seconds: 3 * 60 * 60,
                })}>
                  Reset
                </button>
                <button className="primary-button" onClick={() => void onSaveExam(examForm)}>
                  Save Exam
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
