/**
 * MetricCard.tsx — 数据指标卡片组件
 * 用于在仪表盘中显示单个统计数字（如风险分值、在线人数等）。
 */

// ─────────────────────────────────────────────
// 属性定义
// ─────────────────────────────────────────────

interface MetricCardProps {
  label: string       // 指标名称
  value: string       // 指标数值
  compact?: boolean   // 是否使用紧凑尺寸（用于侧边详情栏）
}

// ─────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────

export function MetricCard({ label, value, compact = false }: MetricCardProps) {
  return (
    <div className={`metric-card ${compact ? 'metric-card-compact' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
