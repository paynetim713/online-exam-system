/**
 * utils.ts — 全局工具函数
 * 供各组件复用的纯函数，不包含任何 React 状态。
 */

import type { CandidateSession } from './types'

// ─────────────────────────────────────────────
// 时间格式化
// ─────────────────────────────────────────────

/** 将 ISO 日期字符串格式化为可读形式，null/undefined 显示为 '-' */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return value.replace('T', ' ')
}

/** 将剩余秒数格式化为 "X hours Y minutes Z seconds" */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(totalSeconds, 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${hours} hours ${minutes} minutes ${seconds} seconds`
}

/** 将剩余秒数格式化为紧凑的 "HH:MM:SS" 格式 */
export function formatCompactTime(totalSeconds: number): string {
  const safe = Math.max(totalSeconds, 0)
  const hours = String(Math.floor(safe / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0')
  const seconds = String(safe % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

// ─────────────────────────────────────────────
// 风险等级与样式
// ─────────────────────────────────────────────

/** 将风险等级映射为 CSS 色调类名（high / medium / low） */
export function getRiskTone(level: CandidateSession['risk_level']): string {
  if (level === 'High') return 'high'
  if (level === 'Medium') return 'medium'
  return 'low'
}

/** 根据角色返回登录页面的 CSS 主题类名 */
export function getPortalTheme(variant: 'candidate' | 'proctor' | 'admin'): string {
  if (variant === 'proctor') return 'portal-login-proctor'
  if (variant === 'admin') return 'portal-login-admin'
  return 'portal-login-candidate'
}
