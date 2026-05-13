/**
 * LandingPage.tsx — 系统首页（高级重设计版）
 *
 * 动效特性：
 *  - 6 个浮动彩色光晕球（CSS @keyframes，各自独立轨迹）
 *  - 点阵网格纹理 + 暗角压边
 *  - 主标题 RA / MFA 分段着色，MFA 持续流动渐变
 *  - 入场动画：Hero 淡升 + 三张卡片依次错开
 *  - 每张卡片 3D 视差倾斜（onMouseMove → CSS 变量 --rx / --ry）
 *  - 悬停时鼠标跟随扫光（CSS radial-gradient via --mx / --my）
 *  - 扫描线动画 + 彩色边框发光
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface LandingPageProps {
  onCandidate: () => void
  onProctor:   () => void
  onAdmin:     () => void
}

// ─────────────────────────────────────────────
// SVG 图标（线条风格，继承 currentColor）
// ─────────────────────────────────────────────

const IconCandidate = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* 档案/考卷外轮廓 */}
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    {/* 右上角折角 */}
    <path d="M14 2v6h6" />
    
    {/* 考生头像 (带有微弱高光填充以突出主体) */}
    <circle cx="12" cy="11" r="2.5" fill="currentColor" fillOpacity="0.12" />
    {/* 考生肩膀 */}
    <path d="M7 19a5 5 0 0 1 10 0" fill="currentColor" fillOpacity="0.12" />
  </svg>
);

const IconProctor = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* 监考记事板 */}
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    {/* 顶部夹子 */}
    <rect x="9" y="2" width="6" height="4" rx="1" />
    
    {/* 专注之眼的外眶 */}
    <path d="M7 14s2-3 5-3 5 3 5 3-2 3-5 3-5-3-5-3z" />
    {/* 瞳孔 (高光填充) */}
    <circle cx="12" cy="14" r="1.5" fill="currentColor" fillOpacity="0.15" />
  </svg>
);

const IconAdmin = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* 核心盾牌外轮廓 (带有整体微弱安全光环填充) */}
    <path 
      d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" 
      fill="currentColor" 
      fillOpacity="0.08" 
    />
    
    {/* 完美对称的几何钥匙孔 */}
    <path d="M12 9a2 2 0 0 0-1.5 3.3l-.5 3.7h4l-.5-3.7A2 2 0 0 0 12 9z" />
  </svg>
);
// ─────────────────────────────────────────────
// 入口卡片数据
// ─────────────────────────────────────────────

interface RoleDef {
  key:   string
  icon:  ReactNode
  label: string
  sub:   string
  cls:   string
  newTabHref?: string
}

const ROLES: RoleDef[] = [
  { key: 'candidate', icon: <IconCandidate />, label: 'Candidate',   sub: 'Sit your exam',       cls: 'lp-card-candidate', newTabHref: '/?role=candidate' },
  { key: 'proctor',   icon: <IconProctor />,   label: 'Invigilator', sub: 'Monitor live',         cls: 'lp-card-proctor',   newTabHref: '/?role=proctor'   },
  { key: 'admin',     icon: <IconAdmin />,     label: 'Admin',       sub: 'Manage the platform',  cls: 'lp-card-admin'     },
]

// ─────────────────────────────────────────────
// 单张卡片（含 3D 视差 + 鼠标扫光）
// ─────────────────────────────────────────────

function PortalCard({ role, onClick }: { role: RoleDef; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)

  function handleNewTab(e: React.MouseEvent) {
    e.stopPropagation()
    window.open(role.newTabHref, '_blank', 'noopener,noreferrer')
  }

  /** 鼠标在卡片内移动：更新倾斜角度和扫光位置 */
  function handleMove(e: React.MouseEvent) {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width  - 0.5  // −0.5 … 0.5
    const ny = (e.clientY - r.top)  / r.height - 0.5
    el.style.setProperty('--rx', `${ny * -14}deg`)
    el.style.setProperty('--ry', `${nx *  14}deg`)
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width  * 100).toFixed(1)}%`)
    el.style.setProperty('--my', `${((e.clientY - r.top)  / r.height * 100).toFixed(1)}%`)
  }

  /** 鼠标离开：平滑归位 */
  function handleLeave() {
    const el = ref.current; if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  return (
    <button
      ref={ref}
      className={`lp-card ${role.cls}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {/* 鼠标跟随扫光层 */}
      <span className="lp-card-shine" aria-hidden />
      {/* 进入时的扫描线（CSS 动画） */}
      <span className="lp-card-scan" aria-hidden />

      <div className="lp-card-icon">{role.icon}</div>
      <div className="lp-card-label">{role.label}</div>
      <div className="lp-card-sub">{role.sub}</div>
      <div className="lp-card-arrow">→</div>
      {role.newTabHref && (
        <span
          className="lp-card-newtab"
          role="button"
          tabIndex={0}
          onClick={handleNewTab}
          onKeyDown={(e) => e.key === 'Enter' && handleNewTab(e as unknown as React.MouseEvent)}
          title="Open in new tab"
        >
          ↗ new tab
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export function LandingPage({ onCandidate, onProctor, onAdmin }: LandingPageProps) {
  const handlers = [onCandidate, onProctor, onAdmin]

  return (
    <div className="lp-root">

      {/* ── 动态背景层 ── */}
      <div className="lp-bg" aria-hidden>
        {/* 6 个各自独立运动轨迹的彩色光晕球 */}
        <div className="lp-orb lp-orb-1" />
        <div className="lp-orb lp-orb-2" />
        <div className="lp-orb lp-orb-3" />
        <div className="lp-orb lp-orb-4" />
        <div className="lp-orb lp-orb-5" />
        <div className="lp-orb lp-orb-6" />
        <div className="lp-grid" />       {/* 点阵纹理 */}
        <div className="lp-vignette" />   {/* 边缘暗化 */}
      </div>

      {/* ── 主内容 ── */}
      <main className="lp-main">

        {/* 标题区（整体入场动画） */}
        <div className="lp-hero">
          <div className="lp-wordmark">
            <span className="lp-wm-ra">RA</span>
            <span className="lp-wm-dash">—</span>
            <span className="lp-wm-mfa">MFA</span>
          </div>
          <p className="lp-caption">Risk-Adaptive Multi-Factor Authentication</p>
        </div>

        {/* 三张入口卡片 */}
        <div className="lp-cards">
          {ROLES.map((r, i) => (
            <PortalCard key={r.key} role={r} onClick={handlers[i]} />
          ))}
        </div>

      </main>

      {/* ── 底部状态栏 ── */}
      <footer className="lp-footer">
        <span className="lp-footer-dot" />
        System Online
      </footer>
    </div>
  )
}
