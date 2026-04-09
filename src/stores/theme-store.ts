import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeState {
  mode: ThemeMode
  resolved: 'dark' | 'light'
  setMode: (mode: ThemeMode) => void
  init: () => void
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(resolved: 'dark' | 'light') {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
  }
}

let mqListenerAttached = false

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  resolved: 'dark',

  setMode: async (mode) => {
    const resolved = resolveTheme(mode)
    applyTheme(resolved)
    set({ mode, resolved })
    try { await invoke('save_setting', { key: 'theme_mode', value: mode }) } catch {}
  },

  init: async () => {
    let mode: ThemeMode = 'dark'
    try {
      const saved = await invoke<string | null>('get_setting_cmd', { key: 'theme_mode' })
      if (saved === 'light' || saved === 'dark' || saved === 'system') mode = saved
    } catch {}

    const resolved = resolveTheme(mode)
    applyTheme(resolved)
    set({ mode, resolved })

    // 监听系统主题变化（单例 store，生命周期与 app 一致，无需 remove）
    if (!mqListenerAttached) {
      mqListenerAttached = true
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        const { mode: currentMode } = get()
        if (currentMode === 'system') {
          const newResolved = resolveTheme('system')
          applyTheme(newResolved)
          set({ resolved: newResolved })
        }
      }
      mq.addEventListener('change', handler)
    }
  },
}))
