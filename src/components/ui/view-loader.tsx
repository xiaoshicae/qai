import { Loader2 } from 'lucide-react'
import { SkeletonSettings } from './skeleton'

interface ViewLoaderProps {
  /** 加载器变体 */
  variant?: 'spinner' | 'settings'
}

export function ViewLoader({ variant = 'spinner' }: ViewLoaderProps) {
  if (variant === 'settings') {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-xl">
          <SkeletonSettings />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}
