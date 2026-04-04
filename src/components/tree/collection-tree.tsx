import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Play, Plus, FolderPlus, Trash2, Pencil, MoreHorizontal, Link2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { cn } from '@/lib/utils'
import type { Collection, CollectionTreeNode } from '@/types'
import { useCollectionStore } from '@/stores/collection-store'
import { useStatusStore } from '@/stores/status-store'
import { Input } from '@/components/ui/input'
import { ContextMenu, menuItemClass, menuDangerClass, menuDividerClass } from '@/components/ui/context-menu'

interface CollectionTreeProps {
  collections: Collection[]
  trees: Record<string, CollectionTreeNode>
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

interface ContextMenu {
  x: number
  y: number
  type: 'collection' | 'folder' | 'request'
  id: string
  collectionId: string
  name: string
  isChain?: boolean
}

export default function CollectionTree({ collections, trees, selectedNodeId, onSelect }: CollectionTreeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { loadTree, createItem, createFolder, deleteCollection, renameCollection, selectNode } = useCollectionStore()
  const loadForCollection = useStatusStore((s) => s.loadForCollection)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const toggle = useCallback(async (id: string, collectionId?: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (collectionId) {
      if (!trees[collectionId]) await loadTree(collectionId)
      loadForCollection(collectionId)
    }
  }, [trees, loadTree, loadForCollection])

  const expand = useCallback((id: string) => {
    setExpanded((prev) => new Set(prev).add(id))
  }, [])

  const handleContextMenu = (e: React.MouseEvent, type: ContextMenu['type'], id: string, collectionId: string, name: string, isChain?: boolean) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, type, id, collectionId, name, isChain })
  }

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
    setMenu(null)
  }

  const commitRename = async (type: string, id: string, collectionId: string) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name) return

    try {
      if (type === 'collection') {
        await renameCollection(id, name)
      } else if (type === 'request' || type === 'folder') {
        await invoke('update_item', { id, payload: { name } })
        await loadTree(collectionId)
      }
    } catch (e) { toast.error(invokeErrorMessage(e)) }
  }

  const handleMenuAction = async (action: string) => {
    if (!menu) return
    const { type, id, collectionId, name } = menu
    setMenu(null)

    switch (action) {
      case 'add-request': {
        expand(type === 'collection' ? collectionId : id)
        const reqId = await createItem(collectionId, type === 'folder' ? id : null, t('tree.new_request'), 'GET')
        if (reqId) {
          selectNode(reqId)
          onSelect(reqId)
        }
        break
      }
      case 'add-folder':
        expand(type === 'collection' ? collectionId : id)
        await createFolder(collectionId, type === 'folder' ? id : null, t('tree.new_folder'))
        break
      case 'add-chain':
        expand(type === 'collection' ? collectionId : id)
        await createItem(collectionId, type === 'folder' ? id : null, t('tree.new_chain'), 'GET', 'chain')
        break
      case 'rename':
        startRename(id, name)
        break
      case 'run': {
        await loadTree(collectionId)
        const nodeId = type === 'collection' ? collectionId : id
        selectNode(nodeId)
        onSelect(nodeId)
        navigate('/')
        break
      }
      case 'delete':
        if (type === 'collection') {
          await deleteCollection(id)
        } else if (type === 'request' || type === 'folder') {
          try {
            await invoke('delete_item', { id })
            await loadTree(collectionId)
            if (selectedNodeId === id) selectNode(null)
          } catch (e) { toast.error(invokeErrorMessage(e)) }
        }
        break
    }
  }

  return (
    <div className="text-[13px] space-y-0.5">
      {collections.map((col) => {
        const tree = trees[col.id]
        const isExpanded = expanded.has(col.id)
        return (
          <div key={col.id}>
            <TreeRow
              id={col.id}
              icon={isExpanded ? <FolderOpen className="h-4 w-4 text-primary/70" /> : <Folder className="h-4 w-4 text-muted-foreground" />}
              chevron={isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
              label={col.name}
              level={0}
              selected={selectedNodeId === col.id}
              renaming={renamingId === col.id}
              renameValue={renameValue}
              showMore
              onRenameChange={setRenameValue}
              onRenameCommit={() => commitRename('collection', col.id, col.id)}
              onClick={() => toggle(col.id, col.id)}
              onDoubleClick={() => startRename(col.id, col.name)}
              onContextMenu={(e) => handleContextMenu(e, 'collection', col.id, col.id, col.name)}
              onMoreClick={(e) => handleContextMenu(e, 'collection', col.id, col.id, col.name)}
            />
            {isExpanded && tree?.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                collectionId={col.id}
                level={1}
                expanded={expanded}
                selectedNodeId={selectedNodeId}
                renamingId={renamingId}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onStartRename={startRename}
                onToggle={toggle}
                onSelect={onSelect}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        )
      })}

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {getMenuItems(menu.type, menu.isChain, t).map((item) =>
            item.separator ? (
              <div key={item.key} className={menuDividerClass} />
            ) : (
              <button
                key={item.key}
                className={item.danger ? menuDangerClass : menuItemClass}
                onClick={() => handleMenuAction(item.key)}
              >
                {item.icon}
                {item.label}
              </button>
            )
          )}
        </ContextMenu>
      )}
    </div>
  )
}

function getMenuItems(type: ContextMenu['type'], _isChain: boolean | undefined, t: (key: string) => string) {
  const items: { key: string; label?: string; icon?: React.ReactNode; danger?: boolean; separator?: boolean }[] = []
  if (type === 'collection' || type === 'folder') {
    items.push({ key: 'add-request', label: t('tree.add_request'), icon: <Plus className="h-3.5 w-3.5" /> })
    items.push({ key: 'add-folder', label: t('tree.add_folder'), icon: <FolderPlus className="h-3.5 w-3.5" /> })
    items.push({ key: 'add-chain', label: t('tree.add_chain'), icon: <Link2 className="h-3.5 w-3.5" /> })
    items.push({ key: 'run', label: t('tree.run_all'), icon: <Play className="h-3.5 w-3.5" /> })
    items.push({ key: 'sep1', separator: true })
  }
  items.push({ key: 'rename', label: t('tree.rename'), icon: <Pencil className="h-3.5 w-3.5" /> })
  items.push({ key: 'delete', label: t('tree.delete'), icon: <Trash2 className="h-3.5 w-3.5" />, danger: true })
  return items
}

interface TreeNodeProps {
  node: CollectionTreeNode
  collectionId: string
  level: number
  expanded: Set<string>
  selectedNodeId: string | null
  renamingId: string | null
  renameValue: string
  onRenameChange: (v: string) => void
  onRenameCommit: (type: string, id: string, collectionId: string) => void
  onStartRename: (id: string, name: string) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, type: ContextMenu['type'], id: string, collectionId: string, name: string, isChain?: boolean) => void
}

function TreeNode({ node, collectionId, level, expanded, selectedNodeId, renamingId, renameValue, onRenameChange, onRenameCommit, onStartRename, onToggle, onSelect, onContextMenu }: TreeNodeProps) {
  const isExpanded = expanded.has(node.id)
  const nodeType = node.node_type
  const status = useStatusStore((s) => s.statuses[node.id])

  if (nodeType === 'request') {
    const method = node.method?.toUpperCase() ?? ''
    const colorClass = METHOD_COLORS[method] ?? 'text-muted-foreground'
    const statusDot = status
      ? status.status === 'success' ? 'bg-success' : 'bg-error'
      : ''
    return (
      <TreeRow
        id={node.id}
        icon={
          <span className="relative shrink-0">
            <span className={cn('text-[10px] font-bold font-mono w-8 text-right inline-block tracking-tight', colorClass)}>{method.substring(0, 4)}</span>
            {statusDot && <span className={cn('absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full', statusDot)} />}
          </span>
        }
        label={node.name}
        level={level}
        selected={selectedNodeId === node.id}
        renaming={renamingId === node.id}
        renameValue={renameValue}
        onRenameChange={onRenameChange}
        onRenameCommit={() => onRenameCommit('request', node.id, collectionId)}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onStartRename(node.id, node.name)}
        onContextMenu={(e) => onContextMenu(e, 'request', node.id, collectionId, node.name)}
      />
    )
  }

  const isChain = nodeType === 'chain'

  return (
    <div>
      <TreeRow
        id={node.id}
        icon={isChain
          ? <Link2 className="h-3.5 w-3.5 text-warning" />
          : isExpanded ? <FolderOpen className="h-3.5 w-3.5 text-primary/60" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
        chevron={isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
        label={node.name}
        level={level}
        selected={selectedNodeId === node.id}
        renaming={renamingId === node.id}
        renameValue={renameValue}
        showMore
        onRenameChange={onRenameChange}
        onRenameCommit={() => onRenameCommit('folder', node.id, collectionId)}
        onClick={() => { if (isChain) onSelect(node.id); onToggle(node.id) }}
        onDoubleClick={() => onStartRename(node.id, node.name)}
        onContextMenu={(e) => onContextMenu(e, 'folder', node.id, collectionId, node.name, isChain)}
        onMoreClick={(e) => onContextMenu(e, 'folder', node.id, collectionId, node.name, isChain)}
      />
      {isExpanded && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          collectionId={collectionId}
          level={level + 1}
          expanded={expanded}
          selectedNodeId={selectedNodeId}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameCommit={onRenameCommit}
          onStartRename={onStartRename}
          onToggle={onToggle}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  )
}

interface TreeRowProps {
  id: string
  icon: React.ReactNode
  chevron?: React.ReactNode
  label: string
  level: number
  selected: boolean
  renaming: boolean
  renameValue: string
  showMore?: boolean
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onClick: () => void
  onDoubleClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onMoreClick?: (e: React.MouseEvent) => void
}

function TreeRow({ icon, chevron, label, level, selected, renaming, renameValue, showMore, onRenameChange, onRenameCommit, onClick, onDoubleClick, onContextMenu, onMoreClick }: TreeRowProps) {
  return (
    <div
      className={cn(
        'group/row flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] transition-all duration-150',
        selected ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-foreground/70 hover:bg-overlay/[0.04] hover:text-foreground'
      )}
      style={{ paddingLeft: `${level * 14 + 8}px` }}
      onClick={renaming ? undefined : onClick}
      onDoubleClick={renaming ? undefined : onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {chevron ?? <span className="w-3" />}
      {icon}
      {renaming ? (
        <Input
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit()
            if (e.key === 'Escape') onRenameCommit()
          }}
          className="h-5 text-xs flex-1 py-0 px-1"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="truncate flex-1">{label}</span>
          {showMore && (
            <button
              className="shrink-0 p-0.5 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-opacity"
              onClick={(e) => { e.stopPropagation(); onMoreClick?.(e) }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  )
}
