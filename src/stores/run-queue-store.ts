import { create } from 'zustand'

/** 多集合运行队列 */
interface RunQueueState {
  /** 有序队列，等待执行的 collection IDs */
  pendingQueue: string[]
  /** 当前正在执行的 collection ID（由 hook 接管） */
  currentRunningId: string | null
  /** 入队（去重） */
  enqueue: (ids: string[]) => void
  /** 当前集合开始执行：从队列头取出，标记为 currentRunning */
  startRun: (id: string) => void
  /** 当前集合执行完毕 */
  finishRun: () => void
  /** 停止：清空队列 + currentRunning */
  clear: () => void
}

export const useRunQueueStore = create<RunQueueState>((set) => ({
  pendingQueue: [],
  currentRunningId: null,
  enqueue: (ids) => set((s) => {
    const existing = new Set([...s.pendingQueue, ...(s.currentRunningId ? [s.currentRunningId] : [])])
    const newIds = ids.filter((id) => !existing.has(id))
    return { pendingQueue: [...s.pendingQueue, ...newIds] }
  }),
  startRun: (id) => set((s) => ({
    pendingQueue: s.pendingQueue.filter((x) => x !== id),
    currentRunningId: id,
  })),
  finishRun: () => set({ currentRunningId: null }),
  clear: () => set({ pendingQueue: [], currentRunningId: null }),
}))

/** 全局运行配置（跨集合共享） */
interface RunConfigState {
  runMode: 'concurrent' | 'sequential'
  concurrency: number
  delayMs: number
  dryRun: boolean
  setRunMode: (mode: 'concurrent' | 'sequential') => void
  setConcurrency: (n: number) => void
  setDelayMs: (ms: number) => void
  setDryRun: (v: boolean) => void
}

export const useRunConfigStore = create<RunConfigState>((set) => ({
  runMode: 'concurrent',
  concurrency: 5,
  delayMs: 3000,
  dryRun: false,
  setRunMode: (runMode) => set({ runMode }),
  setConcurrency: (concurrency) => set({ concurrency }),
  setDelayMs: (delayMs) => set({ delayMs }),
  setDryRun: (dryRun) => set({ dryRun }),
}))
