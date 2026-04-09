import { describe, it, expect, beforeEach } from 'vitest'
import { useRunQueueStore, useRunConfigStore } from './run-queue-store'

describe('run-queue-store', () => {
  beforeEach(() => {
    useRunQueueStore.setState({ pendingQueue: [], currentRunningId: null })
  })

  describe('enqueue', () => {
    it('添加 ID 到队列', () => {
      useRunQueueStore.getState().enqueue(['a', 'b', 'c'])
      expect(useRunQueueStore.getState().pendingQueue).toEqual(['a', 'b', 'c'])
    })

    it('去重：已在队列中的不重复入队', () => {
      useRunQueueStore.getState().enqueue(['a', 'b'])
      useRunQueueStore.getState().enqueue(['b', 'c'])
      expect(useRunQueueStore.getState().pendingQueue).toEqual(['a', 'b', 'c'])
    })

    it('去重：正在运行的 ID 不入队', () => {
      useRunQueueStore.setState({ currentRunningId: 'a' })
      useRunQueueStore.getState().enqueue(['a', 'b'])
      expect(useRunQueueStore.getState().pendingQueue).toEqual(['b'])
    })

    it('空数组不改变队列', () => {
      useRunQueueStore.getState().enqueue(['a'])
      useRunQueueStore.getState().enqueue([])
      expect(useRunQueueStore.getState().pendingQueue).toEqual(['a'])
    })
  })

  describe('startRun', () => {
    it('从队列移除并设为 currentRunning', () => {
      useRunQueueStore.getState().enqueue(['a', 'b', 'c'])
      useRunQueueStore.getState().startRun('a')
      const s = useRunQueueStore.getState()
      expect(s.currentRunningId).toBe('a')
      expect(s.pendingQueue).toEqual(['b', 'c'])
    })
  })

  describe('finishRun', () => {
    it('清除 currentRunning', () => {
      useRunQueueStore.setState({ currentRunningId: 'a' })
      useRunQueueStore.getState().finishRun()
      expect(useRunQueueStore.getState().currentRunningId).toBeNull()
    })
  })

  describe('clear', () => {
    it('清空队列和 currentRunning', () => {
      useRunQueueStore.setState({ pendingQueue: ['a', 'b'], currentRunningId: 'c' })
      useRunQueueStore.getState().clear()
      const s = useRunQueueStore.getState()
      expect(s.pendingQueue).toEqual([])
      expect(s.currentRunningId).toBeNull()
    })
  })
})

describe('run-config-store', () => {
  beforeEach(() => {
    useRunConfigStore.setState({
      runMode: 'concurrent', concurrency: 5, delayMs: 3000, dryRun: false,
    })
  })

  it('setRunMode 切换模式', () => {
    useRunConfigStore.getState().setRunMode('sequential')
    expect(useRunConfigStore.getState().runMode).toBe('sequential')
  })

  it('setConcurrency 更新并发数', () => {
    useRunConfigStore.getState().setConcurrency(10)
    expect(useRunConfigStore.getState().concurrency).toBe(10)
  })

  it('setDelayMs 更新延迟', () => {
    useRunConfigStore.getState().setDelayMs(5000)
    expect(useRunConfigStore.getState().delayMs).toBe(5000)
  })

  it('setDryRun 切换', () => {
    useRunConfigStore.getState().setDryRun(true)
    expect(useRunConfigStore.getState().dryRun).toBe(true)
  })
})
