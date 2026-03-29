import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  className?: string
  placeholder?: string
}

export function Select({ value, onChange, options, className, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        className="flex items-center justify-between gap-1.5 w-full h-9 rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 text-sm transition-all duration-200 cursor-pointer hover:border-overlay/[0.12] focus:border-primary/50 focus:ring-2 focus:ring-primary/20 outline-none"
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          {selected?.label ?? placeholder ?? 'u9009u62e9...'}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-full w-max glass-card rounded-xl p-1 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-100">
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm cursor-pointer transition-colors',
                  active ? 'bg-overlay/[0.08] text-foreground' : 'text-foreground/70 hover:bg-overlay/[0.06] hover:text-foreground'
                )}
                onClick={() => { onChange(opt.value); setOpen(false) }}
              >
                <span className="w-4 shrink-0">
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <span className="font-medium">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
