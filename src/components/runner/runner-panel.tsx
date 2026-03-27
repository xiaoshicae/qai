import { useState, useEffect, useRef } from 'react'
import { Play, Download, CheckCircle2, XCircle, Timer, Zap, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useCollectionStore } from '@/stores/collection-store'
import type { BatchResult, TestProgress, ExecutionResult } from '@/types'

export default function RunnerPanel() {
  const { collections } = useCollectionStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [concurrency, setConcurrency] = useState(5)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TestProgress[]>([])
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { unlistenRef.current?.() }
  }, [])

  const progressPercent = (() => {
    if (batchResult) return 100
    if (progress.length > 0) {
      const total = progress[0]?.total ?? 1
      const done = progress.filter((p) => p.status !== 'running').length
      return Math.round((done / total) * 100)
    }
    return 0
  })()

  const passRate = batchResult
    ? batchResult.total > 0 ? Math.round((batchResult.passed / batchResult.total) * 100) : 0
    : 0

  const run = async () => {
    if (!selectedId) return
    setRunning(true)
    setProgress([])
    setBatchResult(null)
    setError(null)
    setExpandedRows(new Set())

    unlistenRef.current = await listen<TestProgress>('test-progress', (event) => {
      setProgress((prev) => {
        const idx = prev.findIndex((x) => x.item_id === event.payload.item_id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = event.payload
          return next
        }
        return [...prev, event.payload]
      })
    })

    try {
      const result = await invoke<BatchResult>('run_collection', { collectionId: selectedId, concurrency })
      setBatchResult(result)
    } catch (e: any) {
      setError(typeof e === 'string' ? e : e.message)
    } finally {
      setRunning(false)
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }

  const exportHtml = async () => {
    if (!batchResult) return
    const html = await invoke<string>('export_report_html', { batchResult })
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qai-report-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">批量执行</h1>

      {/* 控制栏 */}
      <div className="flex items-center gap-2 mb-5">
        <Select
          value={selectedId}
          onChange={setSelectedId}
          options={[{ value: '', label: '选择集合' }, ...collections.map((c) => ({ value: c.id, label: c.name }))]}
          className="flex-1 min-w-0"
          placeholder="选择集合"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">并发</span>
          <Input type="number" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value) || 1)} min={1} max={20} className="w-14 h-8 text-center" />
        </div>
        <Button onClick={run} disabled={running || !selectedId} size="sm" className="gap-1.5 shrink-0">
          <Play className="h-4 w-4" /> 运行
        </Button>
        {batchResult && (
          <Button variant="outline" size="sm" onClick={exportHtml} className="gap-1.5 shrink-0">
            <Download className="h-4 w-4" /> 导出
          </Button>
        )}
      </div>

      {running && (
        <div className="mb-5 space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>执行中...</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} />
        </div>
      )}

      {/* 统计卡片 */}
      {batchResult && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard icon={<Zap className="h-4 w-4" />} value={batchResult.total} label="总计" color="text-primary" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} value={batchResult.passed} label="通过" color="text-emerald-500" />
          <StatCard icon={<XCircle className="h-4 w-4" />} value={batchResult.failed + batchResult.errors} label="失败" color="text-red-500" />
          <div className="rounded-xl bg-card border border-overlay/[0.06] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Timer className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">通过率</span>
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444' }}>
              {passRate}%
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${passRate}%`,
                  background: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-5">{error}</div>}

      {/* 结果表格 */}
      {batchResult && batchResult.results.length > 0 && (
        <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[32px_1fr_80px_70px_80px_70px] gap-2 px-4 py-2 bg-overlay/[0.04] text-xs text-muted-foreground font-medium border-b border-overlay/[0.04]">
            <span />
            <span>请求</span>
            <span>状态</span>
            <span>HTTP</span>
            <span>耗时</span>
            <span>大小</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {batchResult.results.map((result) => (
              <ResultRow
                key={result.execution_id}
                result={result}
                expanded={expandedRows.has(result.execution_id)}
                onToggle={() => toggleRow(result.execution_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 运行中进度列表 */}
      {running && progress.length > 0 && !batchResult && (
        <div className="rounded-xl border border-overlay/[0.06] overflow-hidden max-h-[400px] overflow-y-auto">
          {progress.map((p, i) => (
            <div key={p.item_id} className={`flex items-center gap-2.5 px-4 py-2.5 text-sm ${i % 2 === 0 ? 'bg-card' : 'bg-transparent'}`}>
              <Badge variant={p.status === 'success' ? 'success' : p.status === 'failed' ? 'destructive' : 'secondary'}>
                {p.status === 'success' ? 'PASS' : p.status === 'failed' ? 'FAIL' : p.status === 'running' ? 'RUN' : 'ERR'}
              </Badge>
              <span className="flex-1 truncate">{p.item_name}</span>
              <span className="text-xs text-muted-foreground">{p.current}/{p.total}</span>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!running && !batchResult && progress.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-4">
            <Play className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">选择集合并点击运行</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, value, label, color }: { icon: React.ReactNode; value: string | number; label: string; color: string }) {
  return (
    <div className="rounded-xl bg-card border border-overlay/[0.06] p-4">
      <div className={`flex items-center gap-2 mb-2 ${color}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function ResultRow({ result, expanded, onToggle }: { result: ExecutionResult; expanded: boolean; onToggle: () => void }) {
  const { response: resp } = result
  const statusIcon = result.status === 'success'
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : result.status === 'failed'
    ? <XCircle className="h-3.5 w-3.5 text-red-500" />
    : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <>
      <div
        className="grid grid-cols-[32px_1fr_80px_70px_80px_70px] gap-2 px-4 py-2.5 text-sm border-t border-overlay/[0.04] hover:bg-overlay/[0.03] cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="truncate font-medium">{result.item_name}</span>
        <span className="flex items-center gap-1">
          {statusIcon}
          <span className="text-xs">{result.status === 'success' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'ERR'}</span>
        </span>
        <span className="font-mono text-xs">
          {resp ? (
            <span className={resp.status < 300 ? 'text-emerald-500' : resp.status < 400 ? 'text-amber-500' : 'text-red-500'}>
              {resp.status}
            </span>
          ) : '-'}
        </span>
        <span className="text-xs text-muted-foreground">{resp ? formatTime(resp.time_ms) : '-'}</span>
        <span className="text-xs text-muted-foreground">{resp ? formatSize(resp.size_bytes) : '-'}</span>
      </div>

      {expanded && (
        <div className="border-t border-overlay/[0.04] bg-overlay/[0.03] px-4 py-3 space-y-3">
          {/* 请求信息 */}
          {resp && (
            <div className="grid grid-cols-2 gap-4">
              {/* 响应体预览 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">响应</p>
                <div className="flex items-center gap-2 mb-1.5 text-xs">
                  <Badge variant={resp.status < 300 ? 'success' : 'destructive'}>{resp.status} {resp.status_text}</Badge>
                  <span className="text-muted-foreground">{formatTime(resp.time_ms)}</span>
                  <span className="text-muted-foreground">{formatSize(resp.size_bytes)}</span>
                </div>
                <pre className="text-xs font-mono bg-background rounded-lg p-2.5 overflow-auto max-h-48 border">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { return resp.body }
                  })()}
                </pre>
              </div>

              {/* 响应头 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">响应头</p>
                <div className="text-xs font-mono bg-background rounded-lg p-2.5 overflow-auto max-h-48 border space-y-0.5">
                  {resp.headers.map((h, i) => (
                    <div key={i}>
                      <span className="text-muted-foreground">{h.key}:</span> {h.value}
                    </div>
                  ))}
                  {resp.headers.length === 0 && <span className="text-muted-foreground">无</span>}
                </div>
              </div>
            </div>
          )}

          {/* 断言结果 */}
          {result.assertion_results.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                断言 ({result.assertion_results.filter((a) => a.passed).length}/{result.assertion_results.length} 通过)
              </p>
              <div className="space-y-1">
                {result.assertion_results.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    {a.passed
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                    <span>{a.message}</span>
                    {!a.passed && a.actual && (
                      <span className="text-muted-foreground ml-1">(actual: {a.actual})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {result.error_message && (
            <div className="flex items-start gap-1.5 text-xs text-red-500">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {result.error_message}
            </div>
          )}
        </div>
      )}
    </>
  )
}
