import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useClaudeStore } from './claude-store'
import type { ClaudeTab } from './claude-store'

const mockedInvoke = vi.mocked(invoke)

// crypto.randomUUID mock
const mockUUID = vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8))
vi.stubGlobal('crypto', { randomUUID: mockUUID })

function freshTab(overrides: Partial<ClaudeTab> = {}): ClaudeTab {
  return {
    id: 'tab-1',
    title: 'New Chat',
    messages: [],
    claudeSessionId: null,
    sending: false,
    warmupStatus: 'idle',
    ...overrides,
  }
}

describe('claude-store', () => {
  beforeEach(() => {
    useClaudeStore.setState({
      tabs: [freshTab()],
      activeTabId: 'tab-1',
      cliStatus: 'checking',
      mcpConfigPath: null,
      initialized: false,
    })
    vi.clearAllMocks()
  })

  // ─── createTab ──────────────────────────────────────────
  describe('createTab', () => {
    it('创建新 tab 并切换', () => {
      const newId = useClaudeStore.getState().createTab()
      const s = useClaudeStore.getState()
      expect(s.tabs).toHaveLength(2)
      expect(s.activeTabId).toBe(newId)
    })

    it('达到 MAX_TABS(8) 时不创建新 tab', () => {
      const tabs = Array.from({ length: 8 }, (_, i) => freshTab({ id: `tab-${i}` }))
      useClaudeStore.setState({ tabs, activeTabId: 'tab-0' })
      const id = useClaudeStore.getState().createTab()
      expect(useClaudeStore.getState().tabs).toHaveLength(8)
      expect(id).toBe('tab-0') // 返回当前 activeTabId
    })
  })

  // ─── switchTab ──────────────────────────────────────────
  describe('switchTab', () => {
    it('切换 activeTabId', () => {
      useClaudeStore.setState({
        tabs: [freshTab({ id: 'tab-1' }), freshTab({ id: 'tab-2' })],
        activeTabId: 'tab-1',
      })
      useClaudeStore.getState().switchTab('tab-2')
      expect(useClaudeStore.getState().activeTabId).toBe('tab-2')
    })
  })

  // ─── closeTab ───────────────────────────────────────────
  describe('closeTab', () => {
    it('关闭非 active tab', () => {
      useClaudeStore.setState({
        tabs: [freshTab({ id: 'tab-1' }), freshTab({ id: 'tab-2' })],
        activeTabId: 'tab-1',
      })
      useClaudeStore.getState().closeTab('tab-2')
      expect(useClaudeStore.getState().tabs).toHaveLength(1)
      expect(useClaudeStore.getState().activeTabId).toBe('tab-1')
    })

    it('关闭 active tab 自动切换', () => {
      useClaudeStore.setState({
        tabs: [freshTab({ id: 'tab-1' }), freshTab({ id: 'tab-2' })],
        activeTabId: 'tab-1',
      })
      useClaudeStore.getState().closeTab('tab-1')
      expect(useClaudeStore.getState().tabs).toHaveLength(1)
      expect(useClaudeStore.getState().activeTabId).toBe('tab-2')
    })

    it('关闭最后一个 tab 创建新空 tab', () => {
      useClaudeStore.getState().closeTab('tab-1')
      const s = useClaudeStore.getState()
      expect(s.tabs).toHaveLength(1)
      expect(s.activeTabId).toBeTruthy()
      expect(s.tabs[0].messages).toEqual([])
    })

    it('关闭 sending 状态的 tab 调用 claude_stop', () => {
      mockedInvoke.mockResolvedValue(undefined) // invoke 返回 Promise
      useClaudeStore.setState({
        tabs: [freshTab({ id: 'tab-1', sending: true }), freshTab({ id: 'tab-2' })],
        activeTabId: 'tab-1',
      })
      useClaudeStore.getState().closeTab('tab-1')
      expect(mockedInvoke).toHaveBeenCalledWith('claude_stop')
    })
  })

  // ─── appendMessage ──────────────────────────────────────
  describe('appendMessage', () => {
    it('添加消息到指定 tab', () => {
      useClaudeStore.getState().appendMessage('tab-1', {
        id: 'msg-1', role: 'user', content: 'Hello',
      })
      const tab = useClaudeStore.getState().tabs.find(t => t.id === 'tab-1')
      expect(tab?.messages).toHaveLength(1)
      expect(tab?.messages[0].content).toBe('Hello')
    })
  })

  // ─── updateLastAssistant ────────────────────────────────
  describe('updateLastAssistant', () => {
    it('追加到最后一条 assistant 消息', () => {
      useClaudeStore.setState({
        tabs: [freshTab({
          id: 'tab-1',
          messages: [{ id: 'msg-1', role: 'assistant', content: 'Hello' }],
        })],
        activeTabId: 'tab-1',
      })
      useClaudeStore.getState().updateLastAssistant('tab-1', ' World')
      const tab = useClaudeStore.getState().tabs.find(t => t.id === 'tab-1')
      expect(tab?.messages[0].content).toBe('Hello World')
    })

    it('无 assistant 消息时创建新的', () => {
      useClaudeStore.getState().updateLastAssistant('tab-1', 'First')
      const tab = useClaudeStore.getState().tabs.find(t => t.id === 'tab-1')
      expect(tab?.messages).toHaveLength(1)
      expect(tab?.messages[0].role).toBe('assistant')
    })
  })

  // ─── setSending / setWarmupStatus ───────────────────────
  describe('state setters', () => {
    it('setSending', () => {
      useClaudeStore.getState().setSending('tab-1', true)
      expect(useClaudeStore.getState().tabs[0].sending).toBe(true)
    })

    it('setWarmupStatus', () => {
      useClaudeStore.getState().setWarmupStatus('tab-1', 'ready')
      expect(useClaudeStore.getState().tabs[0].warmupStatus).toBe('ready')
    })

    it('setClaudeSessionId', () => {
      useClaudeStore.getState().setClaudeSessionId('tab-1', 'session-abc')
      expect(useClaudeStore.getState().tabs[0].claudeSessionId).toBe('session-abc')
    })

    it('setCliStatus', () => {
      useClaudeStore.getState().setCliStatus('ready')
      expect(useClaudeStore.getState().cliStatus).toBe('ready')
    })
  })

  // ─── activeTab ──────────────────────────────────────────
  describe('activeTab', () => {
    it('返回当前 active tab', () => {
      const tab = useClaudeStore.getState().activeTab()
      expect(tab?.id).toBe('tab-1')
    })

    it('activeTabId 不匹配时返回 undefined', () => {
      useClaudeStore.setState({ activeTabId: 'nonexistent' })
      expect(useClaudeStore.getState().activeTab()).toBeUndefined()
    })
  })

  // ─── init ───────────────────────────────────────────────
  describe('init', () => {
    it('成功初始化 → cliStatus=ready', async () => {
      mockedInvoke
        .mockResolvedValueOnce({ status: 'ready' })         // claude_check_status
        .mockResolvedValueOnce('/tmp/mcp-config.json')       // prepare_mcp_config
        .mockResolvedValueOnce(false)                        // claude_session_ready
      await useClaudeStore.getState().init()
      expect(useClaudeStore.getState().cliStatus).toBe('ready')
      expect(useClaudeStore.getState().initialized).toBe(true)
    })

    it('CLI 未安装 → cliStatus=not_installed', async () => {
      mockedInvoke.mockResolvedValueOnce({ status: 'not_installed' })
      await useClaudeStore.getState().init()
      expect(useClaudeStore.getState().cliStatus).toBe('not_installed')
    })

    it('invoke 异常 → cliStatus=not_installed', async () => {
      mockedInvoke.mockRejectedValueOnce(new Error('fail'))
      await useClaudeStore.getState().init()
      expect(useClaudeStore.getState().cliStatus).toBe('not_installed')
    })

    it('重复调用 init 不执行', async () => {
      useClaudeStore.setState({ initialized: true })
      await useClaudeStore.getState().init()
      expect(mockedInvoke).not.toHaveBeenCalled()
    })
  })
})
