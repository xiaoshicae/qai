import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { invokeErrorMessage } from '@/lib/invoke-error'

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

function uid() { return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

export const useAIStore = create<AIState>((set) => ({
  open: false,
  messages: [],
  sending: false,

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),

  sendMessage: async (content: string) => {
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    const assistantMsg: ChatMessage = {
      id: uid(),
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
      const errMsg = invokeErrorMessage(e)
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `⚠ ${errMsg}`, loading: false } : m
        ),
        sending: false,
      }))
    }
  },

  clearMessages: () => set({ messages: [] }),
}))
