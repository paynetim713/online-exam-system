/**
 * LoginPortal.tsx — 通用登录页面组件
 * 三种角色（考生 / 监考员 / 管理员）共用同一登录 UI，
 * 通过 variant 属性切换主题色和提示文字。
 */

import { useState } from 'react'
import type { Role } from '../types'
import { getPortalTheme } from '../utils'

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface LoginPortalProps {
  variant: Role           // 角色类型，决定页面配色
  title: string           // 登录页标题
  description: string     // 副标题说明
  hint: string            // 演示账号提示
  onBack: () => void      // 返回首页回调
  /** 提交登录，返回错误信息字符串（成功返回 null） */
  onSubmit: (username: string, password: string) => Promise<string | null> | string | null
  error: string           // 来自父组件的全局错误信息
}

// ─────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────

export function LoginPortal({ variant, title, description, hint, onBack, onSubmit, error }: LoginPortalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)  // 登录请求进行中时禁用按钮

  /** 提交登录表单 */
  async function handleSubmit() {
    setBusy(true)
    await onSubmit(username.trim(), password.trim())
    setBusy(false)
  }

  return (
    <div className={`portal-login ${getPortalTheme(variant)}`}>
      <div className="login-card-dark">
        {/* 返回首页链接 */}
        <button className="login-back-link" onClick={onBack}>
          ← Back to home
        </button>

        <div className="login-card-wordmark">RA-MFA</div>
        <div className="login-card-system">Risk-Adaptive Multi-Factor Authentication</div>
        <div className="login-role-badge">{title}</div>
        <p className="login-role-desc">{description}</p>
        <div className="login-divider" />

        {/* 登录表单 */}
        <div className="login-form-inner">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit() }}
            />
          </label>

          {/* 错误提示 */}
          {error && <div className="inline-alert inline-alert-danger">{error}</div>}

          <button className="login-submit-btn" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'Signing In...' : 'Sign In'}
          </button>

          {/* 演示账号提示 */}
          <div className="login-hint">{hint}</div>
        </div>
      </div>
    </div>
  )
}
