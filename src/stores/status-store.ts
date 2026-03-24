import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { RequestLastStatus } from '@/types'

interface StatusState {
  statuses: Record<string, RequestLastStatus>
  loadForCollection: (collectionId: string) => Promise<void>
}

export const useStatusStore = create<StatusState>((set) => ({
  statuses: {},

  loadForCollection: async (collectionId: string) => {
    try {
      const list = await invoke<RequestLastStatus[]>('get_collection_status', { collectionId })
      set((s) => {
        const next = { ...s.statuses }
        for (const item of list) {
          next[item.request_id] = item
        }
        return { statuses: next }
      })
    } catch {}
  },
}))
