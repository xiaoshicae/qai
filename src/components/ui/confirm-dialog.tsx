import { create } from 'zustand'
import { AlertTriangle } from 'lucide-react'
import { Button } from './button'

interface ConfirmState {
  open: boolean
  title: string
  message: string
  kind: 'warning' | 'info'
  resolve: ((value: boolean) => void) | null
}

interface ConfirmActions {
  confirm: (message: string, options?: { title?: string; kind?: 'warning' | 'info' }) => Promise<boolean>
  handleConfirm: () => void
  handleCancel: () => void
}

export const useConfirmStore = create<ConfirmState & ConfirmActions>((set, get) => ({
  open: false,
  title: '',
  message: '',
  kind: 'info',
  resolve: null,
  confirm: (message, options) => {
    return new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: options?.title ?? '确认',
        message,
        kind: options?.kind ?? 'info',
        resolve,
      })
    })
  },
  handleConfirm: () => {
    get().resolve?.(true)
    set({ open: false, resolve: null })
  },
  handleCancel: () => {
    get().resolve?.(false)
    set({ open: false, resolve: null })
  },
}))

export function ConfirmDialog() {
  const { open, title, message, kind, handleConfirm, handleCancel } = useConfirmStore()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCancel} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          className="relative z-50 w-full max-w-sm glass-card rounded-2xl p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
            if (e.key === 'Escape') handleCancel()
          }}
        >
          <div className="flex items-start gap-3.5">
            {kind === 'warning' && (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 mt-5">
            <Button variant="outline" size="sm" onClick={handleCancel} autoFocus>
              取消
            </Button>
            <Button
              variant={kind === 'warning' ? 'destructive' : 'default'}
              size="sm"
              onClick={handleConfirm}
              className={kind === 'warning' ? 'bg-destructive/15 hover:bg-destructive/25 text-destructive border-destructive/20' : ''}
            >
              确定
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
