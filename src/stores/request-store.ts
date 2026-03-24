import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { ApiRequest, ExecutionResult } from '@/types'

interface RequestUpdates {
  name?: string
  method?: string
  url?: string
  headers?: string
  queryParams?: string
  bodyType?: string
  bodyContent?: string
}

interface RequestState {
  currentRequest: ApiRequest | null
  currentResponse: ExecutionResult | null
  loading: boolean
  loadRequest: (id: string) => Promise<void>
  updateRequest: (updates: RequestUpdates) => Promise<void>
  sendRequest: () => Promise<void>
}

export const useRequestStore = create<RequestState>((set, get) => ({
  currentRequest: null,
  currentResponse: null,
  loading: false,

  loadRequest: async (id: string) => {
    const req = await invoke<ApiRequest>('get_request', { id })
    set({ currentRequest: req, currentResponse: null })
  },

  updateRequest: async (updates: RequestUpdates) => {
    const { currentRequest } = get()
    if (!currentRequest) return
    const req = await invoke<ApiRequest>('update_request', { id: currentRequest.id, ...updates })
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
          request_id: currentRequest.id,
          request_name: currentRequest.name,
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
}))
