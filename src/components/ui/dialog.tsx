import * as React from "react"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const previousFocusRef = useRef<Element | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 用 ref 保持最新回调，避免 useEffect 因 onOpenChange 引用变化而重跑
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChangeRef.current(false)
        return
      }

      if (e.key === 'Tab' && containerRef.current) {
        const focusableEls = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        if (focusableEls.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusableEls[0]
        const last = focusableEls[focusableEls.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    // 初始聚焦——仅在 open 变为 true 时执行一次
    const timer = requestAnimationFrame(() => {
      if (containerRef.current) {
        const firstFocusable = containerRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        if (firstFocusable) {
          firstFocusable.focus()
        } else {
          containerRef.current.focus()
        }
      }
    })

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      cancelAnimationFrame(timer)

      const elToRestore = previousFocusRef.current
      if (elToRestore && elToRestore instanceof HTMLElement) {
        requestAnimationFrame(() => elToRestore.focus())
      }
    }
  }, [open]) // 只依赖 open，不再因 onOpenChange 引用变化重跑

  if (!open) return null
  return (
    <div ref={containerRef} className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  )
}

function DialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "relative z-50 w-full max-w-lg rounded-2xl p-5 text-sm glass-card shadow-2xl",
        className
      )}
    >
      {children}
    </div>
  )
}

function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left mb-4", className)}>{children}</div>
}

function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-sm font-semibold leading-none tracking-tight", className)}>{children}</h2>
}

function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] transition-all duration-200 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 outline-none cursor-pointer"
      onClick={onClose}
    >
      <X className="h-4 w-4" />
    </button>
  )
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose }
