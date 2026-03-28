import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Check, ChevronDown } from 'lucide-react'

interface Env {
  id: string
  name: string
  is_active: boolean
}

export default function EnvSelector() {
  const [envs, setEnvs] = useState<Env[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const active = envs.find((e) => e.is_active)

  useEffect(() => { load() }, [])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const load = async () => {
    try {
      const list = await invoke<Env[]>('list_environments')
      setEnvs(list)
    } catch {}
  }

  const select = async (id: string | null) => {
    try {
      if (id) {
        await invoke('set_active_environment', { id })
      } else {
        // 取消所有激活
        for (const e of envs) {
          if (e.is_active) await invoke('set_active_environment', { id: e.id })
        }
      }
      await load()
      setOpen(false)
    } catch {}
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex items-center gap-1.5 h-6 px-2 rounded-lg text-[11px] text-muted-foreground hover:text-foreground border border-overlay/[0.06] hover:border-overlay/[0.1] cursor-pointer transition-all duration-200"
      >
        {active ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
            <span>{active.name}</span>
          </>
        ) : (
          <span className="italic">No Env</span>
        )}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-48 rounded-xl glass-card shadow-xl z-50 py-1 overflow-hidden">
          <button
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors ${!active ? 'text-foreground' : 'text-muted-foreground'}`}
            onClick={() => select(null)}
          >
            <span className="w-3.5">{!active && <Check className="h-3 w-3 text-emerald-500" />}</span>
            No Environment
          </button>
          <div className="h-px bg-overlay/[0.06] my-0.5" />
          {envs.map((e) => (
            <button
              key={e.id}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors ${e.is_active ? 'text-foreground' : 'text-muted-foreground'}`}
              onClick={() => select(e.id)}
            >
              <span className="w-3.5">{e.is_active && <Check className="h-3 w-3 text-emerald-500" />}</span>
              {e.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
