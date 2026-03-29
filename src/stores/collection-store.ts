import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { Collection, CollectionTreeNode, Group } from '@/types'

interface CollectionState {
  collections: Collection[]
  trees: Record<string, CollectionTreeNode>
  groups: Group[]
  selectedNodeId: string | null
  selectedRequestId: string | null
  loadCollections: () => Promise<void>
  loadTree: (collectionId: string) => Promise<void>
  loadGroups: () => Promise<void>
  createCollection: (name: string, description: string, groupId?: string | null) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  createItem: (collectionId: string, parentId: string | null, name: string, method: string, itemType?: string) => Promise<string>
  createFolder: (collectionId: string, parentId: string | null, name: string) => Promise<void>
  createGroup: (name: string, parentId?: string | null) => Promise<Group>
  updateGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  selectNode: (nodeId: string | null) => void
}

function findNode(tree: CollectionTreeNode, id: string): CollectionTreeNode | null {
  if (tree.id === id) return tree
  for (const child of tree.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function findCollectionForNode(trees: Record<string, CollectionTreeNode>, nodeId: string): string | null {
  for (const [colId, tree] of Object.entries(trees)) {
    if (findNode(tree, nodeId)) return colId
  }
  return null
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  trees: {},
  groups: [],
  selectedNodeId: null,
  selectedRequestId: null,

  loadCollections: async () => {
    try {
      const collections = await invoke<Collection[]>('list_collections')
      set({ collections })
      await Promise.allSettled(collections.map((col) => get().loadTree(col.id)))
    } catch (e) {
      console.error('loadCollections failed:', e)
    }
  },

  loadTree: async (collectionId: string) => {
    try {
      const tree = await invoke<CollectionTreeNode>('get_collection_tree', { collectionId })
      set((state) => ({ trees: { ...state.trees, [collectionId]: tree } }))
    } catch (e) {
      console.error('loadTree failed:', collectionId, e)
    }
  },

  loadGroups: async () => {
    try {
      const groups = await invoke<Group[]>('list_groups')
      set({ groups })
    } catch (e) {
      console.error('loadGroups failed:', e)
    }
  },

  createCollection: async (name: string, description: string, groupId?: string | null) => {
    const col = await invoke<Collection>('create_collection', { name, description, groupId: groupId ?? null })
    set((state) => ({ collections: [col, ...state.collections] }))
    await get().loadTree(col.id)
  },

  deleteCollection: async (id: string) => {
    await invoke('delete_collection', { id })
    set((state) => {
      const { [id]: _, ...rest } = state.trees
      return {
        collections: state.collections.filter((c) => c.id !== id),
        trees: rest,
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        selectedRequestId: state.selectedRequestId === id ? null : state.selectedRequestId,
      }
    })
  },

  renameCollection: async (id: string, name: string) => {
    const updated = await invoke<Collection>('update_collection', { id, name })
    set((state) => ({
      collections: state.collections.map((c) => c.id === id ? updated : c),
    }))
    await get().loadTree(id)
  },

  createItem: async (collectionId, parentId, name, method, itemType) => {
    const req = await invoke<{ id: string }>('create_item', { collectionId, parentId, itemType: itemType ?? 'request', name, method })
    await get().loadTree(collectionId)
    return req.id
  },

  createFolder: async (collectionId, parentId, name) => {
    await invoke('create_item', { collectionId, parentId, itemType: 'folder', name, method: 'GET' })
    await get().loadTree(collectionId)
  },

  createGroup: async (name: string, parentId?: string | null) => {
    const group = await invoke<Group>('create_group', { name, parentId: parentId ?? null })
    set((state) => ({ groups: [...state.groups, group] }))
    return group
  },

  updateGroup: async (id: string, name: string) => {
    await invoke('update_group', { id, name })
    set((state) => ({
      groups: state.groups.map((g) => g.id === id ? { ...g, name } : g),
    }))
  },

  deleteGroup: async (id: string) => {
    await invoke('delete_group', { id })
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
    }))
  },

  selectNode: (nodeId: string | null) => {
    if (!nodeId) { set({ selectedNodeId: null, selectedRequestId: null }); return }
    set({ selectedNodeId: nodeId })
    const { trees } = get()
    for (const tree of Object.values(trees)) {
      const node = findNode(tree, nodeId)
      if (node && node.node_type === 'request') {
        set({ selectedRequestId: nodeId })
        return
      }
    }
    // 不是 request 节点（集合或文件夹），清空 requestId 以显示概览
    set({ selectedRequestId: null })
  },
}))

export { findCollectionForNode }
