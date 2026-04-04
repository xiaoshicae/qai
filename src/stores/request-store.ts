import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CollectionItem, ExecutionResult, StreamChunk } from '@/types'
import { extractSSEContent } from '@/lib/media'
import { invokeErrorMessage } from '@/lib/invoke-error'

interface RequestUpdates {
  name?: string
  method?: string
  url?: string
  headers?: string
  queryParams?: string
  bodyType?: string
  bodyContent?: string
  protocol?: string
}

interface RequestState {
  currentRequest: CollectionItem | null
  currentResponse: ExecutionResult | null
  loading: boolean
  streaming: boolean
  streamContent: string
  streamChunks: number
  loadRequest: (id: string) => Promise<void>
  /** 关闭调试抽屉时清空，避免概览区仍引用上一份请求 */
  clearRequest: () => void
  updateRequest: (updates: RequestUpdates) => Promise<void>
  sendRequest: () => Promise<void>
}

export const useRequestStore = create<RequestState>((set, get) => ({
  currentRequest: null,
  currentResponse: null,
  loading: false,
  streaming: false,
  streamContent: '',
  streamChunks: 0,

  loadRequest: async (id: string) => {
    const req = await invoke<CollectionItem>('get_item', { id })
    set({ currentRequest: req, currentResponse: null })
  },

  clearRequest: () =>
    set({
      currentRequest: null,
      currentResponse: null,
      loading: false,
      streaming: false,
      streamContent: '',
      streamChunks: 0,
    }),

  updateRequest: async (updates: RequestUpdates) => {
    const { currentRequest } = get()
    if (!currentRequest) return
    const req = await invoke<CollectionItem>('update_item', { id: currentRequest.id, payload: updates })
    set({ currentRequest: req })
  },

  sendRequest: async () => {
    const { currentRequest } = get()
    if (!currentRequest) return
    set({ loading: true, streamContent: '', streamChunks: 0, currentResponse: null })

    let content = ''
    let chunks = 0
    const unlisten = await listen<StreamChunk>('stream-chunk', (event) => {
      const { chunk, done, item_id } = event.payload
      if (item_id !== currentRequest.id) return
      if (!done && chunk !== '[DONE]') {
        // 首个 chunk 到达时自动切换为流式模式
        if (!get().streaming) set({ streaming: true })
        const delta = extractSSEContent(chunk)
        content += delta ?? chunk + '\n'
        chunks++
        set({ streamContent: content, streamChunks: chunks })
      }
    })

    try {
      // 仅在开发环境记录日志，避免敏感数据暴露
      if (import.meta.env.DEV) {
        console.log(`[QAI] → ${currentRequest.method} ${currentRequest.url}`)
      }
      const result = await invoke<ExecutionResult>('send_request', { id: currentRequest.id })
      if (import.meta.env.DEV) {
        console.log(`[QAI] ← ${result.response?.status ?? 'ERR'}`, {
          time: result.response?.time_ms + 'ms',
          size: result.response?.size_bytes + 'B',
        })
      }
      set({ currentResponse: result })
    } catch (e: unknown) {
      if (import.meta.env.DEV) {
        console.error(`[QAI] ✗ ${currentRequest.method} ${currentRequest.url}`, e)
      }
      set({
        currentResponse: {
          execution_id: '',
          item_id: currentRequest.id,
          item_name: currentRequest.name,
          status: 'error',
          response: null,
          assertion_results: [],
          error_message: invokeErrorMessage(e),
        },
      })
    } finally {
      unlisten()
      set({ loading: false, streaming: false })
    }
  },
}))
