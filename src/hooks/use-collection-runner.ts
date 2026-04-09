import { useState, useRef, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { extractSSEContent } from '@/lib/media'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { useRunQueueStore, useRunConfigStore } from '@/stores/run-queue-store'
import type {
  ItemLastStatus, BatchResult, TestProgress,
  ExecutionResult, ChainResult, ChainProgress, StreamChunk,
} from '@/types'
import type { FlatReq, TableItem } from '@/components/collection/collection-overview-model'

interface Options {
  collectionId: string
  allRequests: FlatReq[]
  tableItems: TableItem[]
}

/** 最小 loading 展示时间，避免极快请求导致页面闪烁 */
const MIN_LOADING_MS = 400

export function useCollectionRunner({ collectionId, allRequests, tableItems }: Options) {
  const [statuses, setStatuses] = useState<Record<string, ItemLastStatus>>({})
  const [running, setRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<TestProgress[]>([])
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [singleResults, setSingleResults] = useState<Record<string, ExecutionResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [streamingContents, setStreamingContents] = useState<Record<string, string>>({})

  /** 运行时直接从 store 读最新配置，避免闭包捕获过期值 */
  const getConfig = () => useRunConfigStore.getState()

  const abortRef = useRef(false)
  /** 统一的 listener 清理函数（并发 + 顺序模式共用） */
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

  // ─── 队列驱动：检测 pendingQueue 前端是否是当前集合，自动触发 runAll ───
  const shouldAutoRun = useRunQueueStore((s) =>
    s.pendingQueue[0] === collectionId && s.currentRunningId === null
  )
  const runAllRef = useRef<() => void>(() => {})
  const autoRunFiredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!shouldAutoRun || allRequests.length === 0) return
    // 防重入：同一个 collectionId 只触发一次
    if (autoRunFiredRef.current === collectionId) return
    autoRunFiredRef.current = collectionId
    useRunQueueStore.getState().startRun(collectionId)
    // 下一微任务触发（比 requestAnimationFrame 更确定）
    // runAllRef 确保使用最新的 runAll，无需将其作为依赖
    queueMicrotask(() => runAllRef.current())
  }, [shouldAutoRun, collectionId, allRequests.length])

  // collectionId 变化时重置防重入标记
  useEffect(() => { autoRunFiredRef.current = null }, [collectionId])

  // 预构建 batchResult 的 Map（O(1) 查找替代 O(N) find）
  const batchResultMap = useMemo(() => {
    if (!batchResult) return null
    const m = new Map<string, ExecutionResult>()
    for (const r of batchResult.results) m.set(r.item_id, r)
    return m
  }, [batchResult])

  const getStatus = (id: string) => {
    const sr = singleResults[id]
    if (sr) return sr.status
    const br = batchResultMap?.get(id)
    if (br) return br.status
    return statuses[id]?.status
  }

  const getResult = (id: string): ExecutionResult | undefined =>
    singleResults[id] ?? batchResultMap?.get(id)

  const { passed, failed, passRate, progressPercent } = useMemo(() => {
    // 内联 getStatus 逻辑，避免函数依赖问题
    const getStatusValue = (id: string) => {
      const sr = singleResults[id]
      if (sr) return sr.status
      const br = batchResultMap?.get(id)
      if (br) return br.status
      return statuses[id]?.status
    }
    const p = allRequests.filter((r) => getStatusValue(r.id) === 'success').length
    const f = allRequests.filter((r) => { const s = getStatusValue(r.id); return s && s !== 'success' }).length
    const rate = (p + f) > 0 ? Math.round((p / (p + f)) * 100) : 0
    const pct = batchResult ? 100
      : progress.length > 0 ? Math.round((progress.filter((x) => x.status !== 'running').length / (progress[0]?.total ?? 1)) * 100)
      : running && total > 0 ? Math.round((Object.keys(singleResults).length / total) * 100)
      : 0
    return { passed: p, failed: f, passRate: rate, progressPercent: pct }
  }, [allRequests, singleResults, batchResultMap, statuses, progress, running, total])

  const runAll = async (excludeIds?: Set<string>) => {
    const { runMode, concurrency, delayMs, dryRun } = getConfig()
    // 兜底：tree 未加载完时直接退出，避免队列卡死
    if (allRequests.length === 0 && tableItems.length === 0) {
      useRunQueueStore.getState().finishRun()
      return
    }
    abortRef.current = false
    const startTime = Date.now()
    setRunning(true); setProgress([]); setBatchResult(null); setSingleResults({}); setError(null); setStatuses({})

    if (runMode === 'sequential') {
      // 构建顺序执行队列：尊重 chain 分组，chain 内部走 runChain（变量传递 + 失败中断）
      const items = excludeIds?.size
        ? tableItems.filter((t) => {
            if ('isChain' in t) return !excludeIds.has(t.groupId)
            return !excludeIds.has(t.id)
          })
        : tableItems

      const contents: Record<string, string> = {}
      // 当前正在执行的 item IDs，用于 stream-chunk 过滤
      const activeItemIds = new Set<string>()
      const unlisten = await listen<StreamChunk>('stream-chunk', (event) => {
        const { chunk, done, item_id } = event.payload
        if (abortRef.current || done || chunk === '[DONE]') return
        if (!activeItemIds.has(item_id)) return
        const delta = extractSSEContent(chunk)
        contents[item_id] = (contents[item_id] ?? '') + (delta ?? chunk + '\n')
        setStreamingContents({ ...contents })
      })
      // 注册到 unlistenRef，确保组件卸载时能清理
      unlistenRef.current = () => unlisten()

      try {
        for (const tableItem of items) {
          if (abortRef.current) break

          if ('isChain' in tableItem) {
            // 链式请求：通过 run_chain 命令执行（自动处理变量传递和失败中断）
            const stepIds = tableItem.steps.map((s) => s.id)
            stepIds.forEach((id) => activeItemIds.add(id))
            setRunningIds((prev) => new Set(prev).add(tableItem.groupId))
            const unlistenChain = await listen<ChainProgress>('chain-progress', (event) => {
              const p = event.payload
              if (p.item_id !== tableItem.groupId) return
              const stepId = stepIds[p.step_index]
              if (!stepId) return
              if (p.status === 'running') {
                setRunningIds((prev) => new Set(prev).add(stepId))
              } else {
                setRunningIds((prev) => { const n = new Set(prev); n.delete(stepId); return n })
              }
            })
            const unlistenResult = await listen<ExecutionResult>('execution-result', (e) => {
              if (!stepIds.includes(e.payload.item_id)) return
              setSingleResults((prev) => ({ ...prev, [e.payload.item_id]: e.payload }))
            })
            try {
              const result = await invoke<ChainResult>('run_chain', { itemId: tableItem.groupId, dryRun })
              if (!abortRef.current) {
                for (const step of result.steps) {
                  setSingleResults((prev) => ({ ...prev, [step.execution_result.item_id]: step.execution_result }))
                }
                if (result.status !== 'success') abortRef.current = true
              }
            } catch (e: unknown) {
              if (!abortRef.current) toast.error(invokeErrorMessage(e))
            } finally {
              unlistenChain()
              unlistenResult()
              stepIds.forEach((id) => activeItemIds.delete(id))
              setRunningIds((prev) => { const n = new Set(prev); stepIds.forEach((id) => n.delete(id)); n.delete(tableItem.groupId); return n })
            }
          } else {
            // 普通请求：逐个发送
            activeItemIds.add(tableItem.id)
            contents[tableItem.id] = ''
            setRunningIds((prev) => new Set(prev).add(tableItem.id))
            setStreamingContents({ ...contents })
            try {
              const result = await invoke<ExecutionResult>('send_request_stream', { id: tableItem.id, dryRun })
              if (!abortRef.current) setSingleResults((prev) => ({ ...prev, [tableItem.id]: result }))
            } catch (e: unknown) {
              if (!abortRef.current) {
                setSingleResults((prev) => ({
                  ...prev,
                  [tableItem.id]: {
                    execution_id: '', item_id: tableItem.id, item_name: tableItem.name,
                    status: 'error', response: null, assertion_results: [],
                    error_message: invokeErrorMessage(e),
                  },
                }))
              }
            }
            activeItemIds.delete(tableItem.id)
            delete contents[tableItem.id]
            setStreamingContents({ ...contents })
            setRunningIds((prev) => { const n = new Set(prev); n.delete(tableItem.id); return n })
          }

          if (delayMs > 0 && !abortRef.current) {
            await new Promise((r) => setTimeout(r, delayMs))
          }
        }
      } finally {
        unlisten()
        unlistenRef.current = null
        setStreamingContents({})
        const elapsed = Date.now() - startTime
        if (elapsed < MIN_LOADING_MS) await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed))
        setRunning(false)
        if (!dryRun) loadStatuses()
        useRunQueueStore.getState().finishRun()
      }
    } else {
      // 构建当前集合的 item ID 集合，用于事件隔离过滤
      const itemIds = new Set(allRequests.map((r) => r.id))
      const unlistenProgress = await listen<TestProgress>('test-progress', (e) => {
        if (abortRef.current || !itemIds.has(e.payload.item_id)) return
        setProgress((prev) => {
          const idx = prev.findIndex((x) => x.item_id === e.payload.item_id)
          if (idx >= 0) { const n = [...prev]; n[idx] = e.payload; return n }
          return [...prev, e.payload]
        })
      })
      // 实时接收每个请求完成的结果（按 item_id 过滤，只接收本集合的）
      const unlistenResult = await listen<ExecutionResult>('execution-result', (e) => {
        if (abortRef.current || !itemIds.has(e.payload.item_id)) return
        setSingleResults((prev) => ({ ...prev, [e.payload.item_id]: e.payload }))
      })
      unlistenRef.current = () => { unlistenProgress(); unlistenResult() }
      try {
        const excludeList = excludeIds?.size ? Array.from(excludeIds) : undefined
        const result = await invoke<BatchResult>('run_collection', { collectionId, concurrency, excludeIds: excludeList, dryRun })
        if (!abortRef.current) { setBatchResult(result); if (!dryRun) loadStatuses() }
      } catch (e: unknown) { if (!abortRef.current) setError(invokeErrorMessage(e)) }
      finally {
        const elapsed = Date.now() - startTime
        if (elapsed < MIN_LOADING_MS) await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed))
        setRunning(false)
        unlistenRef.current?.(); unlistenRef.current = null
        useRunQueueStore.getState().finishRun()
      }
    }
  }

  runAllRef.current = () => runAll()

  const stopRun = () => {
    abortRef.current = true
    invoke('cancel_run').catch(() => {})
    useRunQueueStore.getState().clear()
    // 不立刻 setRunning(false) — 让 runAll 循环检测 abortRef 自然退出后在 finally 中设置
    // 但并发模式的 runAll 会在 invoke 返回后才到 finally，所以这里也设一下以快速反馈 UI
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
      const dr = getConfig().dryRun
      const result = await invoke<ExecutionResult>('send_request_stream', { id: requestId, dryRun: dr })
      setSingleResults((prev) => ({ ...prev, [requestId]: result }))
      if (!dr) loadStatuses()
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
      if (p.item_id !== chainItemId) return
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
      if (!stepIds.includes(e.payload.item_id)) return
      setSingleResults((prev) => ({ ...prev, [e.payload.item_id]: e.payload }))
    })

    try {
      const dr = getConfig().dryRun
      const result = await invoke<ChainResult>('run_chain', { itemId: chainItemId, dryRun: dr })
      for (const step of result.steps) {
        setSingleResults((prev) => ({ ...prev, [step.execution_result.item_id]: step.execution_result }))
      }
      if (!dr) loadStatuses()
    } catch (e: unknown) {
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
    // computed
    total, passed, failed, passRate, progressPercent,
    // actions
    runAll, stopRun, runSingle, runChain,
    getStatus, getResult, loadStatuses, resetResults, clearItemResult, cleanup,
  }
}
