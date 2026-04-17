import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface ClaudeMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
}

export interface ClaudeTab {
  id: string
  title: string
  messages: ClaudeMessage[]
  claudeSessionId: string | null
  sending: boolean
  warmupStatus: 'idle' | 'warming' | 'ready'
}

/** Claude CLI stream-json result 行的部分字段（仅用到的） */
interface ClaudeRawResult {
  session_id?: string
  [key: string]: unknown
}

interface ClaudeEventPayload {
  event_type: 'delta' | 'tool_use' | 'result' | string
  content: string
  session_id: string | null
  raw?: ClaudeRawResult
}

const MAX_TABS = 8

function uid() { return crypto.randomUUID() }

function makeTab(): ClaudeTab {
  return { id: uid(), title: 'New Chat', messages: [], claudeSessionId: null, sending: false, warmupStatus: 'idle' }
}

interface ClaudeStore {
  tabs: ClaudeTab[]
  activeTabId: string | null
  cliStatus: 'checking' | 'not_installed' | 'not_authenticated' | 'ready'
  mcpConfigPath: string | null
  initialized: boolean

  activeTab: () => ClaudeTab | undefined
  createTab: () => string
  switchTab: (tabId: string) => void
  closeTab: (tabId: string) => void

  appendMessage: (tabId: string, msg: ClaudeMessage) => void
  updateLastAssistant: (tabId: string, delta: string) => void
  setSending: (tabId: string, sending: boolean) => void
  setWarmupStatus: (tabId: string, status: ClaudeTab['warmupStatus']) => void
  setClaudeSessionId: (tabId: string, sessionId: string) => void
  setCliStatus: (status: ClaudeStore['cliStatus']) => void

  init: () => Promise<void>
}

export const useClaudeStore = create<ClaudeStore>((set, get) => {
  const updateTab = (tabId: string, updater: (tab: ClaudeTab) => Partial<ClaudeTab>) => {
    set((s) => ({ tabs: s.tabs.map((t) => t.id === tabId ? { ...t, ...updater(t) } : t) }))
  }

  return {
    tabs: [],
    activeTabId: null,
    cliStatus: 'checking',
    mcpConfigPath: null,
    initialized: false,

    activeTab: () => {
      const s = get()
      return s.tabs.find((t) => t.id === s.activeTabId)
    },

    createTab: () => {
      const s = get()
      if (s.tabs.length >= MAX_TABS) return s.activeTabId!
      const tab = makeTab()
      set({ tabs: [...s.tabs, tab], activeTabId: tab.id })
      return tab.id
    },

    switchTab: (tabId) => set({ activeTabId: tabId }),

    closeTab: (tabId) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (tab?.sending) invoke('claude_stop').catch(() => {})

      const remaining = s.tabs.filter((t) => t.id !== tabId)
      if (remaining.length === 0) {
        const fresh = makeTab()
        set({ tabs: [fresh], activeTabId: fresh.id })
      } else {
        const newActive = s.activeTabId === tabId
          ? remaining[Math.min(s.tabs.findIndex((t) => t.id === tabId), remaining.length - 1)].id
          : s.activeTabId
        set({ tabs: remaining, activeTabId: newActive })
      }
    },

    appendMessage: (tabId, msg) => updateTab(tabId, (t) => ({ messages: [...t.messages, msg] })),

    updateLastAssistant: (tabId, delta) => updateTab(tabId, (t) => {
      const msgs = [...t.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta }
      } else {
        msgs.push({ id: uid(), role: 'assistant', content: delta })
      }
      return { messages: msgs }
    }),

    setSending: (tabId, sending) => updateTab(tabId, () => ({ sending })),

    setWarmupStatus: (tabId, warmupStatus) => updateTab(tabId, () => ({ warmupStatus })),

    setClaudeSessionId: (tabId, sessionId) => updateTab(tabId, () => ({ claudeSessionId: sessionId })),

    setCliStatus: (cliStatus) => set({ cliStatus }),

    init: async () => {
      if (get().initialized) return
      set({ initialized: true })

      // 1. 创建默认 tab
      const firstTab = makeTab()
      set({ tabs: [firstTab], activeTabId: firstTab.id })

      // 2. 检测 CLI
      try {
        const status = await invoke<{ status: string }>('claude_check_status')
        if (status.status === 'not_installed') { set({ cliStatus: 'not_installed' }); return }
        if (status.status === 'not_authenticated') { set({ cliStatus: 'not_authenticated' }); return }
        set({ cliStatus: 'ready' })
      } catch {
        set({ cliStatus: 'not_installed' }); return
      }

      // 3. 准备 MCP 配置
      try {
        const configPath = await invoke<string>('prepare_mcp_config')
        set({ mcpConfigPath: configPath })
      } catch {}

      const warmSpare = () => {
        invoke('claude_warmup_spare', { mcpConfigPath: get().mcpConfigPath }).catch(() => {})
      }

      // 4. 检查 session 就绪状态
      try {
        const ready = await invoke<boolean>('claude_session_ready')
        if (ready) {
          updateTab(firstTab.id, () => ({ warmupStatus: 'ready' as const }))
          warmSpare() // 主 session 就绪后，后台预热备用
          // 继续注册事件监听（不 return）
        }
      } catch {}

      // 5. 等待预热完成
      if (get().tabs.find((t) => t.id === firstTab.id)?.warmupStatus !== 'ready') {
        updateTab(firstTab.id, () => ({ warmupStatus: 'warming' as const }))
      }

      // 全局 warmup-done 监听
      listen('claude-warmup-done', () => {
        const s = get()
        const active = s.tabs.find((t) => t.id === s.activeTabId)
        if (active && active.warmupStatus === 'warming') {
          updateTab(active.id, () => ({ warmupStatus: 'ready' as const }))
        }
        warmSpare() // 每次 warmup 完成后预热备用
      })

      // spare 就绪事件
      listen('claude-spare-ready', () => {
        // spare 已就绪，无需额外处理，take_spare 时会取到
      })

      listen<ClaudeEventPayload>('claude-event', (event) => {
        const { event_type, content, session_id } = event.payload
        const s = get()

        // 根据 session_id 找 tab，找不到则用 activeTab
        const targetTab = (session_id && s.tabs.find((t) => t.claudeSessionId === session_id))
          || s.tabs.find((t) => t.id === s.activeTabId)
        if (!targetTab) return
        const tid = targetTab.id

        switch (event_type) {
          case 'delta':
            get().updateLastAssistant(tid, content)
            get().setWarmupStatus(tid, 'ready')
            break
          case 'tool_use':
            get().appendMessage(tid, { id: uid(), role: 'tool', content })
            break
          case 'result': {
            const tab = get().tabs.find((t) => t.id === tid)
            const lastMsg = tab?.messages[tab.messages.length - 1]
            // 有内容则显示为 assistant 消息
            if (content && (!lastMsg || lastMsg.role !== 'assistant')) {
              get().appendMessage(tid, { id: uid(), role: 'assistant', content })
            }
            // 无内容且上一条是用户的斜杠命令 → 给个完成反馈
            if (!content && lastMsg?.role === 'user' && lastMsg.content.startsWith('/')) {
              get().appendMessage(tid, { id: uid(), role: 'assistant', content: '✓ Done' })
            }
            // 从 result 中提取新的 session_id
            const raw = event.payload.raw
            if (raw?.session_id) {
              get().setClaudeSessionId(tid, raw.session_id)
            }
            get().setSending(tid, false)
            get().setWarmupStatus(tid, 'ready')
            break
          }
        }
      })
    },
  }
})
