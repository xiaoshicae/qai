import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/** 统一空状态组件 — 用于列表/表格/面板无数据时的占位展示 */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-4 ${className}`}>
      {Icon && (
        <div className="h-10 w-10 rounded-xl bg-overlay/[0.06] flex items-center justify-center mb-3">
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      )}
      {title && <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>}
      {description && <p className="text-xs text-muted-foreground/60 max-w-[240px]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
