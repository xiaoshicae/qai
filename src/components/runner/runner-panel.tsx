import { useState, useEffect, useRef } from 'react'
import { Play, Download, CheckCircle, XCircle, Timer, Zap } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useCollectionStore } from '@/stores/collection-store'
import type { BatchResult, TestProgress } from '@/types'

export default function RunnerPanel() {
  const { collections } = useCollectionStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [concurrency, setConcurrency] = useState(5)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TestProgress[]>([])
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const run = async () => {
    if (!selectedId) return
    setRunning(true)
    setProgress([])
    setBatchResult(null)
    setError(null)

    unlistenRef.current = await listen<TestProgress>('test-progress', (event) => {
      setProgress((prev) => {
        const idx = prev.findIndex((x) => x.request_id === event.payload.request_id)
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">批量执行</h1>

      {/* 控制栏 */}
      <div className="flex items-center gap-2 mb-5">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 min-w-0 h-8 rounded-lg border border-input bg-transparent px-3 text-sm cursor-pointer focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none dark:bg-input/30"
        >
          <option value="">选择集合</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
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

      {/* 统计 */}
      {batchResult && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard icon={<Zap className="h-4 w-4" />} value={batchResult.total} label="总计" color="text-primary" />
          <StatCard icon={<CheckCircle className="h-4 w-4" />} value={batchResult.passed} label="通过" color="text-emerald-500" />
          <StatCard icon={<XCircle className="h-4 w-4" />} value={batchResult.failed} label="失败" color="text-red-500" />
          <StatCard icon={<Timer className="h-4 w-4" />} value={`${batchResult.total_time_ms}ms`} label="耗时" color="text-amber-500" />
        </div>
      )}

      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-5">{error}</div>}

      {/* 结果列表 */}
      {(batchResult?.results ?? progress).length > 0 && (
        <div className="rounded-xl ring-1 ring-foreground/10 overflow-hidden max-h-[400px] overflow-y-auto">
          {(batchResult?.results ?? progress).map((p: any, i: number) => (
            <div key={p.request_id ?? p.execution_id} className={`flex items-center gap-2.5 px-4 py-2.5 text-sm ${i % 2 === 0 ? 'bg-card' : 'bg-transparent'}`}>
              <Badge variant={p.status === 'success' ? 'success' : p.status === 'failed' ? 'destructive' : 'secondary'}>
                {p.status === 'success' ? 'PASS' : p.status === 'failed' ? 'FAIL' : p.status === 'running' ? 'RUN' : 'ERR'}
              </Badge>
              <span className="flex-1 truncate">{p.request_name ?? p.execution_id?.substring(0, 8)}</span>
              {p.response && <span className="text-xs text-muted-foreground font-mono">{p.response.status} · {p.response.time_ms}ms</span>}
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
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4">
      <div className={`flex items-center gap-2 mb-2 ${color}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}
