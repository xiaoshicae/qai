import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useCollectionStore, findCollectionForNode } from './collection-store'
import type { CollectionTreeNode } from '@/types'

const mockedInvoke = vi.mocked(invoke)

// 构建测试用树
function makeTree(): CollectionTreeNode {
  return {
    id: 'col-1',
    name: 'Test Collection',
    node_type: 'collection',
    method: undefined,
    expect_status: undefined,
    children: [
      {
        id: 'folder-1',
        name: 'Auth',
        node_type: 'folder',
        method: undefined,
        expect_status: undefined,
        children: [
          {
            id: 'req-1',
            name: 'Login',
            node_type: 'request',
            method: 'POST',
            expect_status: 200,
            children: [],
          },
        ],
      },
      {
        id: 'req-2',
        name: 'Health Check',
        node_type: 'request',
        method: 'GET',
        expect_status: 200,
        children: [],
      },
    ],
  }
}

describe('collection-store', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      collections: [],
      trees: {},
      groups: [],
      selectedNodeId: null,
      selectedRequestId: null,
    })
    vi.clearAllMocks()
  })

  // ─── findCollectionForNode ────────────────────────────────

  describe('findCollectionForNode', () => {
    it('找到节点所在的集合 ID', () => {
      const trees = { 'col-1': makeTree() }
      expect(findCollectionForNode(trees, 'req-1')).toBe('col-1')
    })

    it('节点不存在返回 null', () => {
      const trees = { 'col-1': makeTree() }
      expect(findCollectionForNode(trees, 'non-existent')).toBeNull()
    })

    it('空 trees 返回 null', () => {
      expect(findCollectionForNode({}, 'req-1')).toBeNull()
    })

    it('从根节点查找', () => {
      const trees = { 'col-1': makeTree() }
      expect(findCollectionForNode(trees, 'col-1')).toBe('col-1')
    })
  })

  // ─── selectNode ───────────────────────────────────────────

  describe('selectNode', () => {
    it('选中 request 节点设置 selectedRequestId', () => {
      useCollectionStore.setState({ trees: { 'col-1': makeTree() } })
      useCollectionStore.getState().selectNode('req-1')
      const state = useCollectionStore.getState()
      expect(state.selectedNodeId).toBe('req-1')
      expect(state.selectedRequestId).toBe('req-1')
    })

    it('选中 folder 节点清空 selectedRequestId', () => {
      useCollectionStore.setState({ trees: { 'col-1': makeTree() } })
      useCollectionStore.getState().selectNode('folder-1')
      const state = useCollectionStore.getState()
      expect(state.selectedNodeId).toBe('folder-1')
      expect(state.selectedRequestId).toBeNull()
    })

    it('选中 collection 节点清空 selectedRequestId', () => {
      useCollectionStore.setState({ trees: { 'col-1': makeTree() } })
      useCollectionStore.getState().selectNode('col-1')
      const state = useCollectionStore.getState()
      expect(state.selectedNodeId).toBe('col-1')
      expect(state.selectedRequestId).toBeNull()
    })
  })

  // ─── loadCollections ──────────────────────────────────────

  describe('loadCollections', () => {
    it('成功加载集合列表', async () => {
      const mockCollections = [
        { id: 'col-1', name: 'Test', description: '', group_id: null, created_at: '', updated_at: '' },
      ]
      mockedInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_collections') return mockCollections
        if (cmd === 'get_collection_tree') return makeTree()
        return null
      })

      await useCollectionStore.getState().loadCollections()
      const state = useCollectionStore.getState()
      expect(state.collections).toEqual(mockCollections)
      expect(state.trees['col-1']).toBeDefined()
    })

    it('加载失败不崩溃', async () => {
      mockedInvoke.mockRejectedValue(new Error('fail'))
      await useCollectionStore.getState().loadCollections()
      expect(useCollectionStore.getState().collections).toEqual([])
    })
  })

  // ─── deleteCollection ─────────────────────────────────────

  describe('deleteCollection', () => {
    it('删除后从 state 中移除', async () => {
      useCollectionStore.setState({
        collections: [{ id: 'col-1', name: 'Test', description: '', group_id: null, created_at: '', updated_at: '' }],
        trees: { 'col-1': makeTree() },
      })
      mockedInvoke.mockResolvedValue(undefined)

      await useCollectionStore.getState().deleteCollection('col-1')
      const state = useCollectionStore.getState()
      expect(state.collections).toHaveLength(0)
      expect(state.trees['col-1']).toBeUndefined()
    })
  })

  // ─── loadGroups ───────────────────────────────────────────

  describe('loadGroups', () => {
    it('成功加载分组', async () => {
      const mockGroups = [{ id: 'g1', name: 'Group 1', parent_id: null, sort_order: 0 }]
      mockedInvoke.mockResolvedValue(mockGroups)

      await useCollectionStore.getState().loadGroups()
      expect(useCollectionStore.getState().groups).toEqual(mockGroups)
    })
  })
})
