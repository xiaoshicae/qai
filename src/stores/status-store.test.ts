import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useStatusStore } from './status-store'

const mockedInvoke = vi.mocked(invoke)

describe('status-store', () => {
  beforeEach(() => {
    useStatusStore.setState({ statuses: {} })
    vi.clearAllMocks()
  })

  describe('loadForCollection', () => {
    it('成功加载状态', async () => {
      const mockStatuses = [
        { item_id: 'i1', status: 'success', executed_at: '2024-01-01', response_time_ms: 50, assertion_total: 2, assertion_passed: 2 },
        { item_id: 'i2', status: 'failed', executed_at: '2024-01-01', response_time_ms: 100, assertion_total: 3, assertion_passed: 1 },
      ]
      mockedInvoke.mockResolvedValue(mockStatuses)

      await useStatusStore.getState().loadForCollection('col-1')
      const { statuses } = useStatusStore.getState()
      expect(statuses['i1'].status).toBe('success')
      expect(statuses['i2'].status).toBe('failed')
      expect(mockedInvoke).toHaveBeenCalledWith('get_collection_status', { collectionId: 'col-1' })
    })

    it('加载失败不崩溃', async () => {
      mockedInvoke.mockRejectedValue(new Error('fail'))
      await useStatusStore.getState().loadForCollection('col-1')
      expect(useStatusStore.getState().statuses).toEqual({})
    })
  })
})
