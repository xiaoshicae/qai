import { useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { extractSSEContent } from '@/lib/media'
import { invokeErrorMessage } from '@/lib/invoke-error'
import type {
  ItemLastStatus, BatchResult, TestProgress,
  ExecutionResult, ChainResult, ChainProgress, StreamChunk,
} from '@/types'
import type { FlatReq } from '@/components/collection/collection-overview-model'

interface Options {
  collectionId: string
  allRequests: FlatReq[]
}

export function useCollectionRunner({ collectionId, allRequests }: Options) {
  const [statuses, setStatuses] = useState<Record<string, ItemLastStatus>>({})
  const [running, setRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<TestProgress[]>([])
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [singleResults, setSingleResults] = useState<Record<string, ExecutionResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [streamingContents, setStreamingContents] = useState<Record<string, string>>({})
  const [runMode, setRunMode] = useState<'concurrent' | 'sequential'>('concurrent')
  const [concurrency, setConcurrency] = useState(5)
  const [delayMs, setDelayMs] = useState(3000)

  const abortRef = useRef(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  const total = allRequests.length

  const loadStatuses = async () => {
    try {
      const list = await invoke<ItemLastStatus[]>('get_collection_status', { collectionId })
      const map: Record<string, ItemLastStatus> = {}
      for (const s of list) map[s.item_id] = s
      setStatuses(map)
    } catch (e) { console.warn('loadStatuses failed:', e) }
  }

  const getStatus = (id: string) => {
    const sr = singleResults[id]
    if (sr) return sr.status
    const br = batchResult?.results.find((x) => x.item_id === id)
    if (br) return br.status
    return statuses[id]?.status
  }

  const getResult = (id: string): ExecutionResult | undefined =>
    singleResults[id] ?? batchResult?.results.find((x) => x.item_id === id)

  const passed = allRequests.filter((r) => getStatus(r.id) === 'success').length
  const failed = allRequests.filter((r) => { const s = getStatus(r.id); return s && s !== 'success' }).length
  const passRate = (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0
  const progressPercent = batchResult ? 100
    : progress.length > 0 ? Math.round((progress.filter((p) => p.status !== 'running').length / (progress[0]?.total ?? 1)) * 100)
    : running && total > 0 ? Math.round((Object.keys(singleResults).length / total) * 100)
    : 0

  const runAll = async (excludeIds?: Set<string>) => {
    abortRef.current = false
    setRunning(true); setProgress([]); setBatchResult(null); setSingleResults({}); setError(null); setStatuses({})
    const requests = excludeIds?.size ? allRequests.filter((r) => !excludeIds.has(r.id)) : allRequests

    if (runMode === 'sequential') {
      const contents: Record<string, string> = {}
      const unlisten = await listen<StreamChunk>('stream-chunk', (event) => {
        const { chunk, done, item_id } = event.payload
        if (abortRef.current || done || chunk === '[DONE]') return
        const delta = extractSSEContent(chunk)
        contents[item_id] = (contents[item_id] ?? '') + (delta ?? chunk + '\n')
        setStreamingContents({ ...contents })
      })
      for (const item of requests) {
        if (abortRef.current) break
        contents[item.id] = ''
        setRunningIds((prev) => new Set(prev).add(item.id))
        setStreamingContents({ ...contents })
        try {
          const result = await invoke<ExecutionResult>('send_request_stream', { id: item.id })
          setSingleResults((prev) => ({ ...prev, [item.id]: result }))
        } catch (e: unknown) {
          setSingleResults((prev) => ({
            ...prev,
            [item.id]: {
              execution_id: '', item_id: item.id, item_name: item.name,
              status: 'error', response: null, assertion_results: [],
              error_message: invokeErrorMessage(e),
            },
          }))
        }
        delete contents[item.id]
        setStreamingContents({ ...contents })
        setRunningIds((prev) => { const n = new Set(prev); n.delete(item.id); return n })
        if (delayMs > 0 && !abortRef.current) {
          await new Promise((r) => setTimeout(r, delayMs))
        }
      }
      unlisten()
      setStreamingContents({})
      setRunning(false)
      loadStatuses()
    } else {
      const unlistenProgress = await listen<TestProgress>('test-progress', (e) => {
        if (abortRef.current) return
        setProgress((prev) => {
          const idx = prev.findIndex((x) => x.item_id === e.payload.item_id)
          if (idx >= 0) { const n = [...prev]; n[idx] = e.payload; return n }
          return [...prev, e.payload]
        })
      })
      // 实时接收每个请求完成的结果（不用等全部跑完）
      const unlistenResult = await listen<ExecutionResult>('execution-result', (e) => {
        if (abortRef.current) return
        setSingleResults((prev) => ({ ...prev, [e.payload.item_id]: e.payload }))
      })
      unlistenRef.current = () => { unlistenProgress(); unlistenResult() }
      try {
        const excludeList = excludeIds?.size ? Array.from(excludeIds) : undefined
        const result = await invoke<BatchResult>('run_collection', { collectionId, concurrency, excludeIds: excludeList })
        if (!abortRef.current) { setBatchResult(result); loadStatuses() }
      } catch (e: unknown) { if (!abortRef.current) setError(invokeErrorMessage(e)) }
      finally { setRunning(false); unlistenRef.current?.(); unlistenRef.current = null }
    }
  }

  const stopRun = () => {
    abortRef.current = true
    invoke('cancel_run').catch(() => {})
    setRunning(false)
    setProgress([])
    setStreamingContents({})
    unlistenRef.current?.()
    unlistenRef.current = null
    loadStatuses()
  }

  const runSingle = async (requestId: string) => {
    setSingleResults((prev) => { const n = { ...prev }; delete n[requestId]; return n })
    setRunningIds((prev) => new Set(prev).add(requestId))
    setStreamingContents((prev) => ({ ...prev, [requestId]: '' }))
    let content = ''
    const unlisten = await listen<StreamChunk>('stream-chunk', (event) => {
      const { chunk, done, item_id } = event.payload
      if (item_id !== requestId || done || chunk === '[DONE]') return
      content += chunk + '\n'
      setStreamingContents((prev) => ({ ...prev, [requestId]: content }))
    })
    try {
      const result = await invoke<ExecutionResult>('send_request_stream', { id: requestId })
      setSingleResults((prev) => ({ ...prev, [requestId]: result }))
      loadStatuses()
    } catch (e: unknown) {
      setSingleResults((prev) => ({
        ...prev,
        [requestId]: {
          execution_id: '', item_id: requestId, item_name: '',
          status: 'error', response: null, assertion_results: [],
          error_message: invokeErrorMessage(e),
        },
      }))
    } finally {
      unlisten()
      setRunningIds((prev) => { const n = new Set(prev); n.delete(requestId); return n })
      setStreamingContents((prev) => { const n = { ...prev }; delete n[requestId]; return n })
    }
  }

  const runChain = async (chainItemId: string, stepIds: string[]) => {
    setRunningIds((prev) => new Set(prev).add(chainItemId))
    setSingleResults((prev) => { const n = { ...prev }; for (const id of stepIds) delete n[id]; return n })
    setStatuses((prev) => { const n = { ...prev }; for (const id of stepIds) delete n[id]; return n })

    const unlistenChain = await listen<ChainProgress>('chain-progress', (event) => {
      const p = event.payload
      const stepId = stepIds[p.step_index]
      if (!stepId) return
      if (p.status === 'running') {
        setRunningIds((prev) => new Set(prev).add(stepId))
      } else {
        setRunningIds((prev) => { const n = new Set(prev); n.delete(stepId); return n })
        setProgress((prev) => {
          const idx = prev.findIndex((x) => x.item_id === stepId)
          const entry: TestProgress = { batch_id: '', item_id: stepId, item_name: p.step_name, status: p.status, current: p.step_index + 1, total: p.total_steps }
          if (idx >= 0) { const n = [...prev]; n[idx] = entry; return n }
          return [...prev, entry]
        })
      }
    })
    // 实时接收每步完成结果
    const unlistenResult = await listen<ExecutionResult>('execution-result', (e) => {
      setSingleResults((prev) => ({ ...prev, [e.payload.item_id]: e.payload }))
    })

    try {
      const result = await invoke<ChainResult>('run_chain', { itemId: chainItemId })
      for (const step of result.steps) {
        setSingleResults((prev) => ({ ...prev, [step.execution_result.item_id]: step.execution_result }))
      }
      loadStatuses()
    } catch (e: unknown) {
      console.error('runChain failed:', e)
      toast.error(invokeErrorMessage(e))
    } finally {
      unlistenChain()
      unlistenResult()
      setRunningIds((prev) => { const n = new Set(prev); stepIds.forEach((id) => n.delete(id)); n.delete(chainItemId); return n })
    }
  }

  /** 重置批次结果（新增/删除 item 后调用） */
  const resetResults = () => {
    setBatchResult(null)
    setSingleResults({})
  }

  /** 清除单个 item 的状态和结果（编辑保存后调用） */
  const clearItemResult = (itemId: string) => {
    setSingleResults((prev) => { const n = { ...prev }; delete n[itemId]; return n })
    setBatchResult((prev) => prev ? { ...prev, results: prev.results.filter((r) => r.item_id !== itemId) } : null)
    setStatuses((prev) => { const n = { ...prev }; delete n[itemId]; return n })
    setProgress((prev) => prev.filter((p) => p.item_id !== itemId))
  }

  /** 清理 listener（组件卸载时调用） */
  const cleanup = () => { unlistenRef.current?.() }

  return {
    // state
    statuses, running, runningIds, progress, singleResults, batchResult,
    error, streamingContents,
    runMode, setRunMode, concurrency, setConcurrency, delayMs, setDelayMs,
    // computed
    total, passed, failed, passRate, progressPercent,
    // actions
    runAll, stopRun, runSingle, runChain,
    getStatus, getResult, loadStatuses, resetResults, clearItemResult, cleanup,
  }
}
