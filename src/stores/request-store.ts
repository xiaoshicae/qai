import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CollectionItem, ExecutionResult, StreamChunk } from '@/types'

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
  updateRequest: (updates: RequestUpdates) => Promise<void>
  sendRequest: () => Promise<void>
  sendRequestStream: () => Promise<void>
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

  updateRequest: async (updates: RequestUpdates) => {
    const { currentRequest } = get()
    if (!currentRequest) return
    const req = await invoke<CollectionItem>('update_item', { id: currentRequest.id, payload: updates })
    set({ currentRequest: req })
  },

  sendRequest: async () => {
    const { currentRequest } = get()
    if (!currentRequest) return
    set({ loading: true })
    try {
      const result = await invoke<ExecutionResult>('send_request', { id: currentRequest.id })
      set({ currentResponse: result })
    } catch (e: any) {
      set({
        currentResponse: {
          execution_id: '',
          item_id: currentRequest.id,
          item_name: currentRequest.name,
          status: 'error',
          response: null,
          assertion_results: [],
          error_message: typeof e === 'string' ? e : e.message ?? 'Unknown error',
        },
      })
    } finally {
      set({ loading: false })
    }
  },

  sendRequestStream: async () => {
    const { currentRequest } = get()
    if (!currentRequest) return
    set({ loading: true, streaming: true, streamContent: '', streamChunks: 0, currentResponse: null })

    let content = ''
    let chunks = 0
    const unlisten = await listen<StreamChunk>('stream-chunk', (event) => {
      const { chunk, done, item_id } = event.payload
      if (item_id !== currentRequest.id) return
      if (!done && chunk !== '[DONE]') {
        // 尝试从 SSE JSON 中提取 content
        try {
          const json = JSON.parse(chunk)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            content += delta
            chunks++
            set({ streamContent: content, streamChunks: chunks })
            return
          }
        } catch {
          // 非 JSON 格式，直接追加
        }
        content += chunk + '\n'
        chunks++
        set({ streamContent: content, streamChunks: chunks })
      }
    })

    try {
      const result = await invoke<ExecutionResult>('send_request_stream', { id: currentRequest.id })
      set({ currentResponse: result })
    } catch (e: any) {
      set({
        currentResponse: {
          execution_id: '',
          item_id: currentRequest.id,
          item_name: currentRequest.name,
          status: 'error',
          response: null,
          assertion_results: [],
          error_message: typeof e === 'string' ? e : e.message ?? 'Unknown error',
        },
      })
    } finally {
      unlisten()
      set({ loading: false, streaming: false })
    }
  },
}))
