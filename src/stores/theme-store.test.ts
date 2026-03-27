import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useThemeStore } from './theme-store'

const mockedInvoke = vi.mocked(invoke)

describe('theme-store', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'dark', resolved: 'dark' })
    document.documentElement.classList.remove('dark', 'light')
    vi.clearAllMocks()
  })

  describe('setMode', () => {
    it('设置 dark 模式', async () => {
      mockedInvoke.mockResolvedValue(undefined)
      await useThemeStore.getState().setMode('dark')
      const state = useThemeStore.getState()
      expect(state.mode).toBe('dark')
      expect(state.resolved).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('设置 light 模式', async () => {
      mockedInvoke.mockResolvedValue(undefined)
      await useThemeStore.getState().setMode('light')
      const state = useThemeStore.getState()
      expect(state.mode).toBe('light')
      expect(state.resolved).toBe('light')
      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('设置 system 模式根据 matchMedia 解析', async () => {
      mockedInvoke.mockResolvedValue(undefined)
      // setup.ts 中 matchMedia mock 默认 dark
      await useThemeStore.getState().setMode('system')
      const state = useThemeStore.getState()
      expect(state.mode).toBe('system')
      expect(state.resolved).toBe('dark')
    })
  })

  describe('init', () => {
    it('从设置加载主题', async () => {
      mockedInvoke.mockResolvedValue('light')
      await useThemeStore.getState().init()
      const state = useThemeStore.getState()
      expect(state.mode).toBe('light')
      expect(state.resolved).toBe('light')
    })

    it('无保存设置时使用默认 dark', async () => {
      mockedInvoke.mockResolvedValue(null)
      await useThemeStore.getState().init()
      expect(useThemeStore.getState().mode).toBe('dark')
    })
  })
})
