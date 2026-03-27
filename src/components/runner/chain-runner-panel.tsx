import { useState, useEffect, useRef } from 'react'
import { Play, Loader2, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ChainResult, ChainProgress, ChainStepResult } from '@/types'

interface Props {
  folderId: string
  folderName: string
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-emerald-500', label: 'PASS' },
  failed: { icon: <XCircle className="h-4 w-4" />, color: 'text-red-500', label: 'FAIL' },
  error: { icon: <AlertCircle className="h-4 w-4" />, color: 'text-amber-500', label: 'ERROR' },
  running: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'RUNNING' },
  pending: { icon: <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />, color: 'text-muted-foreground', label: 'PENDING' },
}

export default function ChainRunnerPanel({ folderId, folderName }: Props) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ChainResult | null>(null)
  const [progress, setProgress] = useState<ChainProgress | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const unlistenRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    return () => { unlistenRef.current?.() }
  }, [])

  const handleRun = async () => {
    setRunning(true)
    setResult(null)
    setProgress(null)
    setExpandedSteps(new Set())

    unlistenRef.current?.()
    unlistenRef.current = await listen<ChainProgress>('chain-progress', (event) => {
      setProgress(event.payload)
    })

    try {
      const res = await invoke<ChainResult>('run_chain', { folderId })
      setResult(res)
    } catch (e) {
      setResult({
        chain_id: '',
        folder_id: folderId,
        folder_name: folderName,
        total_steps: 0,
        completed_steps: 0,
        status: 'error',
        total_time_ms: 0,
        steps: [],
        final_variables: {},
      })
    } finally {
      setRunning(false)
      setProgress(null)
      unlistenRef.current?.()
    }
  }

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="p-6 space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">{folderName}</h2>
          <Badge variant="secondary" className="text-xs">请求链</Badge>
        </div>
        <Button onClick={handleRun} disabled={running} size="sm" className="gap-1.5">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? '执行中...' : '运行链'}
        </Button>
      </div>

      {/* 进度指示 */}
      {running && progress && (
        <div className="rounded-lg border bg-white/[0.03] p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              步骤 {progress.step_index + 1} / {progress.total_steps}
            </span>
            <span className="font-medium">{progress.step_name}</span>
            <Badge variant="outline" className="text-xs">{progress.status}</Badge>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${((progress.step_index + 1) / progress.total_steps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div className="space-y-4">
          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="总步骤" value={result.total_steps} />
            <StatCard label="已完成" value={result.completed_steps} color="text-emerald-500" />
            <StatCard label="状态" value={STATUS_CONFIG[result.status]?.label ?? result.status} color={STATUS_CONFIG[result.status]?.color} />
            <StatCard label="总耗时" value={formatTime(result.total_time_ms)} />
          </div>

          {/* 步骤列表 */}
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[40px_1fr_80px_80px_80px] gap-2 px-4 py-2 bg-white/[0.04] text-xs text-muted-foreground font-medium border-b">
              <span>#</span>
              <span>请求</span>
              <span>状态</span>
              <span>HTTP</span>
              <span>耗时</span>
            </div>
            {result.steps.map((step) => (
              <StepRow
                key={step.step_index}
                step={step}
                expanded={expandedSteps.has(step.step_index)}
                onToggle={() => toggleStep(step.step_index)}
                formatTime={formatTime}
              />
            ))}
            {/* 未执行的步骤（因 fail-fast 跳过） */}
            {result.completed_steps < result.total_steps && (
              Array.from({ length: result.total_steps - result.completed_steps }, (_, i) => (
                <div key={`skipped-${i}`} className="grid grid-cols-[40px_1fr_80px_80px_80px] gap-2 px-4 py-2.5 text-sm border-t text-muted-foreground/50">
                  <span>{result.completed_steps + i + 1}</span>
                  <span className="italic">已跳过</span>
                  <span>-</span>
                  <span>-</span>
                  <span>-</span>
                </div>
              ))
            )}
          </div>

          {/* 最终变量 */}
          {Object.keys(result.final_variables).length > 0 && (
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="text-sm font-medium">提取的变量</h3>
              <div className="space-y-1">
                {Object.entries(result.final_variables).map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-xs font-mono">
                    <span className="text-amber-500">{`{{${key}}}`}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-foreground truncate">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 空状态 */}
      {!running && !result && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          点击"运行链"按顺序执行请求，变量在步骤间自动传递
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color ?? ''}`}>{value}</p>
    </div>
  )
}

function StepRow({ step, expanded, onToggle, formatTime }: {
  step: ChainStepResult
  expanded: boolean
  onToggle: () => void
  formatTime: (ms: number) => string
}) {
  const { execution_result: er, extracted_variables } = step
  const status = STATUS_CONFIG[er.status] ?? STATUS_CONFIG.pending
  const httpCode = er.response?.status
  const timeMs = er.response?.time_ms

  return (
    <>
      <div
        className="grid grid-cols-[40px_1fr_80px_80px_80px] gap-2 px-4 py-2.5 text-sm border-t hover:bg-white/[0.03] cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {step.step_index + 1}
        </span>
        <span className="truncate font-medium">{er.request_name}</span>
        <span className={`flex items-center gap-1 ${status.color}`}>
          {status.icon}
          <span className="text-xs">{status.label}</span>
        </span>
        <span className="font-mono text-xs">
          {httpCode ? (
            <span className={httpCode < 300 ? 'text-emerald-500' : httpCode < 400 ? 'text-amber-500' : 'text-red-500'}>
              {httpCode}
            </span>
          ) : '-'}
        </span>
        <span className="text-xs text-muted-foreground">{timeMs ? formatTime(timeMs) : '-'}</span>
      </div>

      {expanded && (
        <div className="border-t bg-white/[0.03] px-4 py-3 space-y-3">
          {/* 提取的变量 */}
          {Object.keys(extracted_variables).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">提取变量</p>
              {Object.entries(extracted_variables).map(([k, v]) => (
                <div key={k} className="text-xs font-mono">
                  <span className="text-amber-500">{k}</span>
                  <span className="text-muted-foreground"> = </span>
                  <span className="truncate">{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* 断言结果 */}
          {er.assertion_results.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                断言 ({er.assertion_results.filter((a) => a.passed).length}/{er.assertion_results.length} 通过)
              </p>
              {er.assertion_results.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {a.passed
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    : <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                  <span className="truncate">{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* 响应预览 */}
          {er.response?.body && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">响应</p>
              <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto max-h-40 border">
                {(() => {
                  try { return JSON.stringify(JSON.parse(er.response!.body), null, 2) } catch { return er.response!.body }
                })()}
              </pre>
            </div>
          )}

          {/* 错误信息 */}
          {er.error_message && (
            <div className="text-xs text-red-500">{er.error_message}</div>
          )}
        </div>
      )}
    </>
  )
}
