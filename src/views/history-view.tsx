import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { useCollectionStore } from '@/stores/collection-store'
import { useTabsStore } from '@/stores/tabs-store'
import type { HistoryEntry } from '@/types'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

export default function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const { selectNode } = useCollectionStore()
  const { openTab } = useTabsStore()

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<HistoryEntry[]>('list_history', { limit: 100 })
        setEntries(list)
      } catch {}
      setLoaded(true)
    })()
  }, [])

  const handleClick = (entry: HistoryEntry) => {
    if (entry.item_id) {
      selectNode(entry.item_id)
      openTab(entry.item_id, entry.request_url || 'Request', entry.request_method)
    }
  }

  const formatTime = (s: string) => {
    try {
      const d = new Date(s + 'Z')
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return s
    }
  }

  if (!loaded) return null

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">历史记录</h1>

      {entries.length === 0 ? (
        <EmptyState icon={Clock} title="暂无请求历史" description="发送请求后将自动记录在此" />
      ) : (
        <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
          {entries.map((entry, i) => {
            const method = entry.request_method?.toUpperCase() ?? ''
            const color = METHOD_COLORS[method] ?? 'text-muted-foreground'
            return (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-overlay/[0.04] ${
                  i % 2 === 0 ? 'bg-card' : 'bg-transparent'
                }`}
                onClick={() => handleClick(entry)}
              >
                <span className={`text-[10px] font-bold font-mono w-10 shrink-0 ${color}`}>{method}</span>
                <span className="text-sm truncate flex-1 font-mono text-foreground/80">{entry.request_url || '—'}</span>
                {entry.response_status != null && (
                  <Badge variant={entry.response_status < 400 ? 'success' : 'destructive'}>
                    {entry.response_status}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{entry.response_time_ms}ms</span>
                <span className="text-[11px] text-muted-foreground/60 shrink-0 w-[120px] text-right">{formatTime(entry.executed_at)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
