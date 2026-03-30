import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { TruncatedPre } from '@/components/ui/truncated-pre'
import type { RunRecord, AssertionResultItem } from '@/types'

export default function RunsTab({ requestId }: { requestId: string }) {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<RunRecord[]>('list_item_runs', { itemId: requestId, limit: 20 })
        setRuns(list)
      } catch (e) { toast.error(invokeErrorMessage(e)) }
    })()
  }, [requestId])

  if (runs.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-8">{t('scenario.not_run')}</div>
  }

  return (
    <div className="space-y-1">
      {runs.map((run, i) => {
        const open = expandedId === run.id
        const assertions: AssertionResultItem[] = (() => {
          try { return JSON.parse(run.assertion_results) } catch { return [] }
        })()
        const passedCount = assertions.filter((a) => a.passed).length
        const isSuccess = run.status === 'success'
        const isError = run.status === 'error'

        return (
          <div key={run.id} className="rounded-lg border border-overlay/[0.06] overflow-hidden">
            {/* 摘要行 */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-overlay/[0.04] transition-colors"
              onClick={() => setExpandedId(open ? null : run.id)}
            >
              {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              <span className="text-xs text-muted-foreground w-6 shrink-0">#{runs.length - i}</span>
              {isSuccess ? (
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              ) : isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              )}
              {run.response_status != null && (
                <Badge variant={run.response_status < 400 ? 'success' : 'destructive'} className="text-[10px]">
                  {run.response_status}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{run.response_time_ms}ms</span>
              {assertions.length > 0 && (
                <span className={`text-xs ${passedCount === assertions.length ? 'text-emerald-500' : 'text-red-500'}`}>
                  {passedCount}/{assertions.length}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground/60">{formatTime(run.executed_at)}</span>
            </div>

            {/* 展开详情 */}
            {open && (
              <div className="border-t border-overlay/[0.06] px-3 py-2 space-y-2 bg-card text-xs">
                {/* 请求 */}
                <div>
                  <div className="text-muted-foreground mb-1 font-medium">{t('history.request')}</div>
                  <pre className="font-mono bg-overlay/[0.04] rounded p-2 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
                    {run.request_method} {run.request_url}
                  </pre>
                </div>

                {/* 响应 */}
                {run.response_body && (
                  <div>
                    <div className="text-muted-foreground mb-1 font-medium">{t('history.response')}</div>
                    <div className="bg-overlay/[0.04] rounded p-2 max-h-[200px] overflow-y-auto">
                      <TruncatedPre content={tryPrettyJson(run.response_body)} />
                    </div>
                  </div>
                )}

                {/* 断言结果 */}
                {assertions.length > 0 && (
                  <div>
                    <div className="text-muted-foreground mb-1 font-medium">{t('history.assertions')}</div>
                    <div className="space-y-0.5">
                      {assertions.map((a) => (
                        <div key={a.assertion_id} className="flex items-center gap-1.5">
                          {a.passed
                            ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                            : <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                          }
                          <span className={a.passed ? '' : 'text-red-500'}>{a.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 错误 */}
                {run.error_message && (
                  <div className="text-red-500">{run.error_message}</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatTime(s: string) {
  try {
    const d = new Date(s + 'Z')
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

function tryPrettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}
