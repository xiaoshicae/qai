import { create } from 'zustand'

export interface Tab {
  id: string
  requestId: string
  name: string
  method: string
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  openTab: (requestId: string, name: string, method: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (requestId: string, updates: Partial<Pick<Tab, 'name' | 'method'>>) => void
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (requestId, name, method) => {
    const { tabs } = get()
    const existing = tabs.find((t) => t.requestId === requestId)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const id = `tab-${Date.now()}`
    const tab: Tab = { id, requestId, name, method }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const newTabs = s.tabs.filter((t) => t.id !== id)
      let newActive = s.activeTabId
      if (s.activeTabId === id) {
        const next = newTabs[Math.min(idx, newTabs.length - 1)]
        newActive = next?.id ?? null
      }
      return { tabs: newTabs, activeTabId: newActive }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (requestId, updates) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.requestId === requestId ? { ...t, ...updates } : t
      ),
    }))
  },
}))
