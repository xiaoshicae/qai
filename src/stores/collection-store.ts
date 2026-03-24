import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { Collection, CollectionTreeNode } from '@/types'

interface CollectionState {
  collections: Collection[]
  trees: Record<string, CollectionTreeNode>
  selectedNodeId: string | null
  selectedRequestId: string | null
  loadCollections: () => Promise<void>
  loadTree: (collectionId: string) => Promise<void>
  createCollection: (name: string, description: string) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  createRequest: (collectionId: string, folderId: string | null, name: string, method: string) => Promise<string>
  createFolder: (collectionId: string, parentFolderId: string | null, name: string) => Promise<void>
  selectNode: (nodeId: string) => void
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
  selectedNodeId: null,
  selectedRequestId: null,

  loadCollections: async () => {
    const collections = await invoke<Collection[]>('list_collections')
    set({ collections })
    await Promise.all(collections.map((col) => get().loadTree(col.id)))
  },

  loadTree: async (collectionId: string) => {
    const tree = await invoke<CollectionTreeNode>('get_collection_tree', { collectionId })
    set((state) => ({ trees: { ...state.trees, [collectionId]: tree } }))
  },

  createCollection: async (name: string, description: string) => {
    const col = await invoke<Collection>('create_collection', { name, description })
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
    const updated = await invoke<Collection>('update_collection', { id, name, description: '' })
    set((state) => ({
      collections: state.collections.map((c) => c.id === id ? updated : c),
    }))
    await get().loadTree(id)
  },

  createRequest: async (collectionId, folderId, name, method) => {
    const req = await invoke<{ id: string }>('create_request', { collectionId, folderId, name, method })
    await get().loadTree(collectionId)
    return req.id
  },

  createFolder: async (collectionId, parentFolderId, name) => {
    await invoke('create_folder', { collectionId, parentFolderId, name })
    await get().loadTree(collectionId)
  },

  selectNode: (nodeId: string) => {
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
