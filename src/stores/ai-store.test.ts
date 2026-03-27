import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useAIStore } from './ai-store'

const mockedInvoke = vi.mocked(invoke)

describe('ai-store', () => {
  beforeEach(() => {
    useAIStore.setState({ open: false, messages: [], sending: false })
    vi.clearAllMocks()
  })

  // ─── 纯逻辑 ──────────────────────────────────────────────

  describe('toggleOpen', () => {
    it('切换打开状态', () => {
      expect(useAIStore.getState().open).toBe(false)
      useAIStore.getState().toggleOpen()
      expect(useAIStore.getState().open).toBe(true)
      useAIStore.getState().toggleOpen()
      expect(useAIStore.getState().open).toBe(false)
    })
  })

  describe('setOpen', () => {
    it('直接设置打开状态', () => {
      useAIStore.getState().setOpen(true)
      expect(useAIStore.getState().open).toBe(true)
      useAIStore.getState().setOpen(false)
      expect(useAIStore.getState().open).toBe(false)
    })
  })

  describe('clearMessages', () => {
    it('清空消息列表', () => {
      useAIStore.setState({
        messages: [
          { id: 'msg-1', role: 'user', content: 'hello', timestamp: 0 },
        ],
      })
      useAIStore.getState().clearMessages()
      expect(useAIStore.getState().messages).toEqual([])
    })
  })

  // ─── sendMessage (需 mock invoke) ────────────────────────

  describe('sendMessage', () => {
    it('成功发送消息', async () => {
      mockedInvoke.mockResolvedValue('AI 回复内容')
      await useAIStore.getState().sendMessage('你好')

      const { messages, sending } = useAIStore.getState()
      expect(sending).toBe(false)
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('你好')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('AI 回复内容')
      expect(messages[1].loading).toBe(false)
    })

    it('发送失败显示错误消息', async () => {
      mockedInvoke.mockRejectedValue(new Error('网络错误'))
      await useAIStore.getState().sendMessage('测试')

      const { messages, sending } = useAIStore.getState()
      expect(sending).toBe(false)
      expect(messages).toHaveLength(2)
      expect(messages[1].content).toContain('错误')
      expect(messages[1].content).toContain('网络错误')
      expect(messages[1].loading).toBe(false)
    })

    it('发送期间 sending 为 true', async () => {
      let resolveFn: (value: string) => void
      mockedInvoke.mockReturnValue(new Promise((resolve) => { resolveFn = resolve }))

      const promise = useAIStore.getState().sendMessage('测试')
      expect(useAIStore.getState().sending).toBe(true)

      resolveFn!('done')
      await promise
      expect(useAIStore.getState().sending).toBe(false)
    })
  })
})
