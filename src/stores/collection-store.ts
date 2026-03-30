import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import type { Collection, CollectionTreeNode, Group } from '@/types'
import { invokeErrorMessage } from '@/lib/invoke-error'

interface CollectionState {
  collections: Collection[]
  trees: Record<string, CollectionTreeNode>
  groups: Group[]
  selectedNodeId: string | null
  selectedRequestId: string | null
  /** 当前侧栏请求树所属的集合（点击集合 / 请求时更新） */
  contextCollectionId: string | null
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
  selectedNodeId: (() => { try { const s = localStorage.getItem('qai.selectedNode'); return s ? JSON.parse(s).nodeId : null } catch { return null } })(),
  selectedRequestId: null,
  contextCollectionId: (() => { try { const s = localStorage.getItem('qai.selectedNode'); return s ? JSON.parse(s).contextCollectionId : null } catch { return null } })(),

  loadCollections: async () => {
    try {
      const collections = await invoke<Collection[]>('list_collections')
      set({ collections })
    } catch (e) {
      console.error('loadCollections failed:', e)
      toast.error(invokeErrorMessage(e))
    }
  },

  loadTree: async (collectionId: string) => {
    try {
      const tree = await invoke<CollectionTreeNode>('get_collection_tree', { collectionId })
      set((state) => ({ trees: { ...state.trees, [collectionId]: tree } }))
    } catch (e) {
      console.error('loadTree failed:', collectionId, e)
      toast.error(invokeErrorMessage(e))
    }
  },

  loadGroups: async () => {
    try {
      const groups = await invoke<Group[]>('list_groups')
      set({ groups })
    } catch (e) {
      console.error('loadGroups failed:', e)
      toast.error(invokeErrorMessage(e))
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
        contextCollectionId: state.contextCollectionId === id ? null : state.contextCollectionId,
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
    if (!nodeId) {
      set({ selectedNodeId: null, selectedRequestId: null, contextCollectionId: null })
      try { localStorage.removeItem('qai.selectedNode') } catch {}
      return
    }
    const { trees, collections, contextCollectionId: prevCtx } = get()
    const isTopLevelCollection = collections.some((c) => c.id === nodeId)
    const colFromTree = findCollectionForNode(trees, nodeId)
    const contextCollectionId = colFromTree ?? (isTopLevelCollection ? nodeId : prevCtx)

    let selectedRequestId: string | null = null
    for (const tree of Object.values(trees)) {
      const node = findNode(tree, nodeId)
      if (node?.node_type === 'request') {
        selectedRequestId = nodeId
        break
      }
    }

    set({
      selectedNodeId: nodeId,
      selectedRequestId,
      contextCollectionId,
    })
    try { localStorage.setItem('qai.selectedNode', JSON.stringify({ nodeId, contextCollectionId })) } catch {}
  },
}))

export { findCollectionForNode }
