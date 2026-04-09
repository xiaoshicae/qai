import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { KeyValuePair } from '@/types'

export interface RequestLog {
  id: string
  timestamp: string
  method: string
  url: string
  status: number | null
  status_text: string
  time_ms: number
  size_bytes: number
  error: string | null
  request_headers: KeyValuePair[]
  body_type: string
  response_headers: KeyValuePair[]
}

interface ConsoleState {
  logs: RequestLog[]
  clear: () => void
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  logs: [],
  clear: () => set({ logs: [] }),
}))

/** 在应用启动时调用一次，全局监听 request-log 事件 */
let initialized = false
let unlistenFn: (() => void) | null = null

export function initConsoleListener() {
  if (initialized) return
  initialized = true
  listen<RequestLog>('request-log', (event) => {
    useConsoleStore.setState((s) => ({ logs: [...s.logs, event.payload] }))
  }).then((fn) => { unlistenFn = fn })
}

export function destroyConsoleListener() {
  unlistenFn?.()
  unlistenFn = null
  initialized = false
}
