import { describe, it, expect, beforeEach } from 'vitest'
import { useTabsStore } from './tabs-store'

describe('tabs-store', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  // ─── openTab ──────────────────────────────────────────────

  describe('openTab', () => {
    it('创建新标签并激活', () => {
      useTabsStore.getState().openTab('req-1', 'Get Users', 'GET')
      const { tabs, activeTabId } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].requestId).toBe('req-1')
      expect(tabs[0].name).toBe('Get Users')
      expect(tabs[0].method).toBe('GET')
      expect(activeTabId).toBe(tabs[0].id)
    })

    it('重复打开相同请求不创建新标签', () => {
      useTabsStore.getState().openTab('req-1', 'Get Users', 'GET')
      useTabsStore.getState().openTab('req-1', 'Get Users', 'GET')
      const { tabs } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
    })

    it('重复打开相同请求激活已有标签', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      useTabsStore.getState().openTab('req-2', 'B', 'POST')
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      const { activeTabId, tabs } = useTabsStore.getState()
      expect(activeTabId).toBe(tabs[0].id)
    })

    it('打开多个标签', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      useTabsStore.getState().openTab('req-2', 'B', 'POST')
      useTabsStore.getState().openTab('req-3', 'C', 'PUT')
      const { tabs, activeTabId } = useTabsStore.getState()
      expect(tabs).toHaveLength(3)
      expect(activeTabId).toBe(tabs[2].id)
    })
  })

  // ─── closeTab ─────────────────────────────────────────────

  describe('closeTab', () => {
    it('删除标签', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      const { tabs } = useTabsStore.getState()
      useTabsStore.getState().closeTab(tabs[0].id)
      expect(useTabsStore.getState().tabs).toHaveLength(0)
    })

    it('关闭活跃标签后激活下一个', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      useTabsStore.getState().openTab('req-2', 'B', 'POST')
      // 激活第一个
      const tab1Id = useTabsStore.getState().tabs[0].id
      useTabsStore.getState().setActiveTab(tab1Id)
      // 关闭第一个
      useTabsStore.getState().closeTab(tab1Id)
      const { tabs, activeTabId } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
      expect(activeTabId).toBe(tabs[0].id)
    })

    it('关闭最后一个标签后 activeTabId 为 null', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      const tabId = useTabsStore.getState().tabs[0].id
      useTabsStore.getState().closeTab(tabId)
      expect(useTabsStore.getState().activeTabId).toBeNull()
    })

    it('关闭非活跃标签不影响 activeTabId', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      useTabsStore.getState().openTab('req-2', 'B', 'POST')
      const tab1Id = useTabsStore.getState().tabs[0].id
      const activeId = useTabsStore.getState().activeTabId
      useTabsStore.getState().closeTab(tab1Id)
      expect(useTabsStore.getState().activeTabId).toBe(activeId)
    })
  })

  // ─── setActiveTab ─────────────────────────────────────────

  describe('setActiveTab', () => {
    it('切换活跃标签', () => {
      useTabsStore.getState().openTab('req-1', 'A', 'GET')
      useTabsStore.getState().openTab('req-2', 'B', 'POST')
      const tab1Id = useTabsStore.getState().tabs[0].id
      useTabsStore.getState().setActiveTab(tab1Id)
      expect(useTabsStore.getState().activeTabId).toBe(tab1Id)
    })
  })

  // ─── updateTab ────────────────────────────────────────────

  describe('updateTab', () => {
    it('更新标签名称', () => {
      useTabsStore.getState().openTab('req-1', 'Old', 'GET')
      useTabsStore.getState().updateTab('req-1', { name: 'New' })
      expect(useTabsStore.getState().tabs[0].name).toBe('New')
    })

    it('更新标签方法', () => {
      useTabsStore.getState().openTab('req-1', 'Test', 'GET')
      useTabsStore.getState().updateTab('req-1', { method: 'POST' })
      expect(useTabsStore.getState().tabs[0].method).toBe('POST')
    })

    it('更新不存在的 requestId 无影响', () => {
      useTabsStore.getState().openTab('req-1', 'Test', 'GET')
      useTabsStore.getState().updateTab('non-existent', { name: 'New' })
      expect(useTabsStore.getState().tabs[0].name).toBe('Test')
    })
  })
})
