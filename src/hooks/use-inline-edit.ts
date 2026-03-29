import { useState, useCallback } from 'react'

/**
 * 内联编辑 hook：管理 "点击重命名 → 输入 → 提交/取消" 的状态
 * 消除 sidebar 和 collection-tree 中重复的 renamingId/renameValue 逻辑
 */
export function useInlineEdit(onCommit: (id: string, value: string) => Promise<void> | void) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const start = useCallback((id: string, currentValue: string) => {
    setEditingId(id)
    setEditValue(currentValue)
  }, [])

  const commit = useCallback(async () => {
    const trimmed = editValue.trim()
    if (editingId && trimmed) {
      await onCommit(editingId, trimmed)
    }
    setEditingId(null)
  }, [editingId, editValue, onCommit])

  const cancel = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') cancel()
  }, [commit, cancel])

  return {
    editingId,
    editValue,
    setEditValue,
    start,
    commit,
    cancel,
    handleKeyDown,
    isEditing: (id: string) => editingId === id,
  }
}
