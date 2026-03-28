import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useRequestStore } from './request-store'
import type { CollectionItem, ExecutionResult } from '@/types'

const mockedInvoke = vi.mocked(invoke)

const mockItem: CollectionItem = {
  id: 'item-1',
  collection_id: 'col-1',
  parent_id: null,
  type: 'request',
  name: 'Test Request',
  sort_order: 0,
  method: 'GET',
  url: 'http://example.com',
  headers: '[]',
  query_params: '[]',
  body_type: 'none',
  body_content: '',
  extract_rules: '[]',
  description: '',
  expect_status: 200,
  poll_config: '',
  protocol: 'http',
  created_at: '',
  updated_at: '',
}

const mockResult: ExecutionResult = {
  execution_id: 'exec-1',
  item_id: 'item-1',
  item_name: 'Test Request',
  status: 'success',
  response: {
    status: 200,
    status_text: 'OK',
    headers: [],
    body: '{"ok":true}',
    time_ms: 50,
    size_bytes: 11,
  },
  assertion_results: [],
  error_message: null,
}

describe('request-store', () => {
  beforeEach(() => {
    useRequestStore.setState({
      currentRequest: null,
      currentResponse: null,
      loading: false,
      streaming: false,
      streamContent: '',
      streamChunks: 0,
    })
    vi.clearAllMocks()
  })

  describe('loadRequest', () => {
    it('加载请求并清空响应', async () => {
      mockedInvoke.mockResolvedValue(mockItem)
      await useRequestStore.getState().loadRequest('item-1')

      const state = useRequestStore.getState()
      expect(state.currentRequest).toEqual(mockItem)
      expect(state.currentResponse).toBeNull()
      expect(mockedInvoke).toHaveBeenCalledWith('get_item', { id: 'item-1' })
    })
  })

  describe('updateRequest', () => {
    it('无 currentRequest 时不调用 invoke', async () => {
      await useRequestStore.getState().updateRequest({ name: 'New' })
      expect(mockedInvoke).not.toHaveBeenCalled()
    })

    it('有 currentRequest 时更新', async () => {
      useRequestStore.setState({ currentRequest: mockItem })
      const updated = { ...mockItem, name: 'Updated' }
      mockedInvoke.mockResolvedValue(updated)

      await useRequestStore.getState().updateRequest({ name: 'Updated' })
      expect(useRequestStore.getState().currentRequest?.name).toBe('Updated')
    })
  })

  describe('sendRequest', () => {
    it('无 currentRequest 时不执行', async () => {
      await useRequestStore.getState().sendRequest()
      expect(mockedInvoke).not.toHaveBeenCalled()
    })

    it('成功发送请求', async () => {
      useRequestStore.setState({ currentRequest: mockItem })
      mockedInvoke.mockResolvedValue(mockResult)

      await useRequestStore.getState().sendRequest()
      const state = useRequestStore.getState()
      expect(state.currentResponse).toEqual(mockResult)
      expect(state.loading).toBe(false)
    })

    it('发送失败创建错误响应', async () => {
      useRequestStore.setState({ currentRequest: mockItem })
      mockedInvoke.mockRejectedValue(new Error('Connection refused'))

      await useRequestStore.getState().sendRequest()
      const state = useRequestStore.getState()
      expect(state.currentResponse?.status).toBe('error')
      expect(state.currentResponse?.error_message).toContain('Connection refused')
      expect(state.loading).toBe(false)
    })

    it('发送期间 loading 为 true', async () => {
      useRequestStore.setState({ currentRequest: mockItem })
      let resolveFn: (v: ExecutionResult) => void
      mockedInvoke.mockReturnValue(new Promise((resolve) => { resolveFn = resolve }))

      const promise = useRequestStore.getState().sendRequest()
      expect(useRequestStore.getState().loading).toBe(true)

      resolveFn!(mockResult)
      await promise
      expect(useRequestStore.getState().loading).toBe(false)
    })
  })
})
