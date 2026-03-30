import { Loader2 } from 'lucide-react'

export function ViewLoader() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}
