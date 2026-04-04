import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 骨架屏变体
   * - text: 文本行 (h-4)
   * - title: 标题 (h-6)
   * - avatar: 圆形头像
   * - thumbnail: 方形缩略图
   * - card: 卡片占位
   */
  variant?: 'text' | 'title' | 'avatar' | 'thumbnail' | 'card'
  /** 宽度，默认 auto */
  width?: string | number
  /** 高度，覆盖 variant 默认高度 */
  height?: string | number
  /** 是否为圆形 */
  rounded?: boolean
}

const variantStyles: Record<string, string> = {
  text: 'h-4 rounded',
  title: 'h-6 rounded',
  avatar: 'h-10 w-10 rounded-full',
  thumbnail: 'h-20 w-20 rounded-lg',
  card: 'h-32 rounded-xl',
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  rounded,
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-overlay/[0.08]',
        variantStyles[variant],
        rounded && 'rounded-full',
        className
      )}
      style={{
        width: width ? (typeof width === 'number' ? `${width}px` : width) : undefined,
        height: height ? (typeof height === 'number' ? `${height}px` : height) : undefined,
      }}
      {...props}
    />
  )
}

/** 文本骨架屏组 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  )
}

/** 卡片骨架屏 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card rounded-2xl p-5 space-y-4', className)}>
      <div className="flex items-center gap-3">
        <Skeleton variant="avatar" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="60%" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

/** 列表项骨架屏 */
export function SkeletonList({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="avatar" className="h-8 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="text" width="50%" height={12} className="h-3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 表格骨架屏 */
export function SkeletonTable({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Header */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} variant="text" width="60%" height={12} className="h-3" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid gap-4 py-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton key={colIdx} variant="text" width={colIdx === 0 ? '80%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 设置页面骨架屏 */
export function SkeletonSettings() {
  return (
    <div className="space-y-6 p-6">
      {/* 外观设置卡片 */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Skeleton variant="avatar" className="h-7 w-7 rounded-lg" />
          <Skeleton variant="text" width={100} />
        </div>
        <div className="space-y-3">
          <Skeleton variant="text" width={80} height={12} className="h-3" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton variant="card" className="h-10 rounded-xl" />
            <Skeleton variant="card" className="h-10 rounded-xl" />
            <Skeleton variant="card" className="h-10 rounded-xl" />
          </div>
        </div>
        <Skeleton variant="text" width="100%" height={1} className="h-px" />
        <div className="space-y-3">
          <Skeleton variant="text" width={60} height={12} className="h-3" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton variant="card" className="h-10 rounded-xl" />
            <Skeleton variant="card" className="h-10 rounded-xl" />
          </div>
        </div>
      </div>
      
      {/* AI 配置卡片 */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Skeleton variant="avatar" className="h-7 w-7 rounded-lg" />
          <Skeleton variant="text" width={80} />
        </div>
        <div className="space-y-4">
          <Skeleton variant="text" width={60} height={12} className="h-3" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="card" className="h-12 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton variant="text" width={50} height={12} className="h-3" />
          <Skeleton variant="text" className="h-9 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
