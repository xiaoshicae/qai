import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollText, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDuration, formatSize } from '@/lib/formatters'
import { useConsoleStore, type RequestLog } from '@/stores/console-store'
import { METHOD_COLORS } from '@/lib/styles'

function statusColor(status: number | null): string {
  if (!status) return 'text-destructive'
  if (status >= 200 && status < 300) return 'text-success'
  if (status >= 400) return 'text-destructive'
  return 'text-warning'
}

interface Props {
  onClose: () => void
}

export default function ConsolePanel({ onClose }: Props) {
  const { t } = useTranslation()
  const logs = useConsoleStore((s) => s.logs)
  const clearLogs = useConsoleStore((s) => s.clear)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const handleClear = useCallback(() => {
    clearLogs()
    setExpandedId(null)
  }, [clearLogs])

  return (
    <div className="h-full flex flex-col bg-sidebar">
      {/* 顶部标题栏 + macOS 拖拽区域 */}
      <div className="h-8 shrink-0" data-tauri-drag-region="" />
      <div className="flex items-center justify-between px-4 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('console.title')}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{logs.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] transition-colors"
            title={t('console.clear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="h-px bg-overlay/[0.06] mx-2" />

      {/* 日志列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t('console.empty')}
            description={t('console.empty_hint')}
          />
        ) : (
          <div className="space-y-px">
            {logs.map((log) => (
              <LogEntry
                key={log.id}
                log={log}
                expanded={expandedId === log.id}
                onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}

function LogEntry({ log, expanded, onToggle }: { log: RequestLog; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const isError = !log.status && log.error

  return (
    <div className={`rounded-lg transition-colors ${expanded ? 'bg-overlay/[0.04]' : 'hover:bg-overlay/[0.03]'}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        }
        <span className="text-[10px] text-muted-foreground/60 tabular-nums w-20 shrink-0 font-mono">
          {log.timestamp}
        </span>
        <span className={`text-[11px] font-semibold w-12 shrink-0 ${METHOD_COLORS[log.method] ?? 'text-muted-foreground'}`}>
          {log.method}
        </span>
        {isError ? (
          <span className="text-xs text-destructive truncate flex-1 font-mono">{t('console.error')}</span>
        ) : (
          <span className={`text-xs font-semibold tabular-nums shrink-0 ${statusColor(log.status)}`}>
            {log.status}
          </span>
        )}
        <span className="text-xs text-muted-foreground truncate flex-1 font-mono">
          {log.url}
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
          {formatDuration(log.time_ms)}
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0 w-14 text-right">
          {formatSize(log.size_bytes)}
        </span>
      </button>

      {expanded && (
        <div className="px-8 pb-2.5 space-y-0.5 text-xs font-mono">
          {/* General */}
          <DetailRow label="URL" value={log.url} />
          <DetailRow label="Status" value={log.status ? `${log.status} ${log.status_text}` : 'N/A'} className={statusColor(log.status)} />
          <DetailRow label="Time" value={formatDuration(log.time_ms)} />
          <DetailRow label="Size" value={formatSize(log.size_bytes)} />
          {log.body_type && <DetailRow label="Body" value={log.body_type} />}
          {log.error && <DetailRow label="Error" value={log.error} className="text-destructive" />}

          {/* Request Headers */}
          {log.request_headers.length > 0 && (
            <div className="pt-1.5">
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Request Headers</div>
              {log.request_headers.map((h, i) => (
                <div key={i} className="flex gap-1 pl-2">
                  <span className="text-sky-600 dark:text-sky-400">{h.key}:</span>
                  <span className="text-foreground/80 break-all">{h.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Response Headers */}
          {log.response_headers.length > 0 && (
            <div className="pt-1.5">
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Response Headers</div>
              {log.response_headers.map((h, i) => (
                <div key={i} className="flex gap-1 pl-2">
                  <span className="text-sky-600 dark:text-sky-400">{h.key}:</span>
                  <span className="text-foreground/80 break-all">{h.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground/50 w-12 shrink-0 text-right">{label}</span>
      <span className={`break-all ${className ?? 'text-foreground/80'}`}>{value}</span>
    </div>
  )
}
