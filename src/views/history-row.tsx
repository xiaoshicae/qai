import {
  ChevronDown, ChevronRight, Trash2, ExternalLink,
  CheckCircle, XCircle, AlertCircle, Play,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TruncatedPre } from '@/components/ui/truncated-pre'
import { formatDuration, formatSize } from '@/lib/formatters'
import type { HistoryEntry, AssertionResultItem } from '@/types'

export const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

function tryPrettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

interface Props {
  entry: HistoryEntry
  expanded: boolean
  highlight?: boolean
  onToggle: () => void
  onGoTo: () => void
  onRunAgain: () => void
  onDelete: () => void
  formatTime: (s: string) => string
  t: (key: string, opts?: Record<string, unknown>) => string
}

export function HistoryRow({ entry, expanded, highlight, onToggle, onGoTo, onRunAgain, onDelete, formatTime, t }: Props) {
  const method = entry.request_method?.toUpperCase() ?? ''
  const color = METHOD_COLORS[method] ?? 'text-muted-foreground'
  const isSuccess = entry.status === 'success'
  const isError = entry.status === 'error'

  const assertions: AssertionResultItem[] = (() => {
    try { return JSON.parse(entry.assertion_results) } catch { return [] }
  })()
  const passedCount = assertions.filter((a) => a.passed).length

  return (
    <div
      className={cn(
        'group/row rounded-xl border overflow-hidden transition-[box-shadow,background-color] duration-500',
        highlight ? 'border-primary/50 bg-primary/[0.06] ring-2 ring-primary/25' : 'border-overlay/[0.06]',
      )}
    >
      {/* 摘要行 */}
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-overlay/[0.04]" onClick={onToggle}>
        {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}

        {isSuccess ? <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" /> : isError ? <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-error shrink-0" />}

        <span className={`text-[10px] font-bold font-mono w-12 shrink-0 ${color}`}>{method}</span>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {entry.item_name && <span className="text-sm font-medium truncate max-w-[200px]">{entry.item_name}</span>}
          <span className="text-xs text-muted-foreground font-mono truncate">{entry.request_url || '—'}</span>
        </div>

        {entry.response_status != null && (
          <Badge variant={entry.response_status < 400 ? 'success' : 'destructive'} className="text-[10px]">{entry.response_status}</Badge>
        )}

        {assertions.length > 0 && (
          <span className={`text-xs shrink-0 ${passedCount === assertions.length ? 'text-success' : 'text-error'}`}>{passedCount}/{assertions.length}</span>
        )}

        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatDuration(entry.response_time_ms)}</span>

        {entry.item_id && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.08] cursor-pointer" title={t('history.run_again')} onClick={(e) => { e.stopPropagation(); onRunAgain() }}>
              <Play className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.08] cursor-pointer" title={t('history.go_to_request')} onClick={(e) => { e.stopPropagation(); onGoTo() }}>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <span className="text-[11px] text-muted-foreground/50 shrink-0 w-[80px] text-right">{formatTime(entry.executed_at)}</span>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-overlay/[0.06] px-4 py-3 space-y-3 bg-overlay/[0.02] text-xs">
          <div>
            <div className="text-muted-foreground mb-1 font-medium">{t('history.request')}</div>
            <pre className="font-mono bg-overlay/[0.04] rounded-lg p-2.5 whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">{method} {entry.request_url}</pre>
          </div>

          {entry.response_body && (
            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <span className="font-medium">{t('history.response')}</span>
                {entry.response_size > 0 && <span className="text-muted-foreground/50">{formatSize(entry.response_size)}</span>}
              </div>
              <div className="bg-overlay/[0.04] rounded-lg p-2.5 max-h-[200px] overflow-y-auto">
                <TruncatedPre content={tryPrettyJson(entry.response_body)} />
              </div>
            </div>
          )}

          {assertions.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1 font-medium">{t('history.assertions')}</div>
              <div className="space-y-0.5">
                {assertions.map((a) => (
                  <div key={a.assertion_id} className="flex items-center gap-1.5">
                    {a.passed ? <CheckCircle className="h-3 w-3 text-success shrink-0" /> : <XCircle className="h-3 w-3 text-error shrink-0" />}
                    <span className={a.passed ? '' : 'text-error'}>{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {entry.error_message && <div className="text-error bg-error/5 rounded-lg p-2.5">{entry.error_message}</div>}

          <div className="flex items-center gap-2 pt-1">
            {entry.item_id && (
              <>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRunAgain() }}><Play className="h-3 w-3" />{t('history.run_again')}</Button>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onGoTo() }}><ExternalLink className="h-3 w-3" />{t('history.go_to_request')}</Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete() }}>
              <Trash2 className="h-3 w-3" />{t('common.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
