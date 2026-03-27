import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  loading?: boolean
}

interface AIState {
  open: boolean
  messages: ChatMessage[]
  sending: boolean
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
}

let msgId = 0

export const useAIStore = create<AIState>((set) => ({
  open: false,
  messages: [],
  sending: false,

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),

  sendMessage: async (content: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${++msgId}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    const assistantMsg: ChatMessage = {
      id: `msg-${++msgId}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      loading: true,
    }

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      sending: true,
    }))

    try {
      const response = await invoke<string>('ai_chat', { message: content })
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: response, loading: false } : m
        ),
        sending: false,
      }))
    } catch (e: any) {
      const errMsg = typeof e === 'string' ? e : e.message ?? '请求失败'
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `错误: ${errMsg}`, loading: false } : m
        ),
        sending: false,
      }))
    }
  },

  clearMessages: () => set({ messages: [] }),
}))
