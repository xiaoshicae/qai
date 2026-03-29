import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ContextMenu, menuItemClass, menuDangerClass, menuDividerClass } from '@/components/ui/context-menu'
import { useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import {
  Search, Plus, History, Globe, Settings, Circle,
  ChevronDown, ChevronRight, MoreHorizontal,
  FilePlus, FolderPlus, Play, Pencil, Trash2, GripVertical,
} from 'lucide-react'
import { useCollectionStore } from '@/stores/collection-store'
import { Input } from '@/components/ui/input'
import type { Collection, Group } from '@/types'
import { useTranslation } from 'react-i18next'
import {
  DndContext, closestCenter, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const NAV_ITEMS = [
  { path: '/history', labelKey: 'sidebar.history', icon: History },
  { path: '/environments', labelKey: 'sidebar.environments', icon: Globe },
  { path: '/settings', labelKey: 'sidebar.settings', icon: Settings },
]

// ─── 分组树节点 ─────────────────
interface GroupNode {
  group: Group
  children: GroupNode[]
  collections: Collection[]
}

function buildGroupTree(groups: Group[], collections: Collection[]): { roots: GroupNode[]; ungrouped: Collection[] } {
  const nodeMap = new Map<string, GroupNode>()
  for (const g of groups) {
    nodeMap.set(g.id, { group: g, children: [], collections: [] })
  }
  const roots: GroupNode[] = []
  for (const g of groups) {
    const node = nodeMap.get(g.id)!
    if (g.parent_id && nodeMap.has(g.parent_id)) {
      nodeMap.get(g.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const ungrouped: Collection[] = []
  for (const col of collections) {
    if (col.group_id && nodeMap.has(col.group_id)) {
      nodeMap.get(col.group_id)!.collections.push(col)
    } else {
      ungrouped.push(col)
    }
  }
  roots.sort((a, b) => a.group.sort_order - b.group.sort_order)
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.group.sort_order - b.group.sort_order)
    node.collections.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  return { roots, ungrouped }
}

function countAll(node: GroupNode): number {
  return node.collections.length + node.children.reduce((s, c) => s + countAll(c), 0)
}

// ─── 可排序的 Group 行 ──────────────
function SortableGroupRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'group' } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>
}

// ─── 可排序的 Collection 行 ─────────
function SortableCollectionRow({ id, groupId, children }: { id: string; groupId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'collection', groupId } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>
}

export default function Sidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const confirm = useConfirmStore((s) => s.confirm)
  const { collections, groups, selectedNodeId, loadCollections, loadGroups, createCollection, deleteCollection, renameCollection, createGroup, updateGroup, deleteGroup, selectNode, loadTree } = useCollectionStore()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; target: 'group' | 'col'; groupId?: string; col?: Collection } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [inlineInput, setInlineInput] = useState<{ parentGroupId: string; type: 'group' | 'suite' } | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const [newTopGroup, setNewTopGroup] = useState(false)
  const [newTopValue, setNewTopValue] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  // dnd-kit sensors: 需要拖动 5px 才触发，避免和点击冲突
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => { loadCollections(); loadGroups() }, [])

  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current && groups.length > 0) {
      initializedRef.current = true
      setExpanded((prev) => new Set([...prev, ...groups.filter((g) => !g.parent_id).map((g) => g.id)]))
    }
  }, [groups])

  const { roots, ungrouped } = useMemo(() => buildGroupTree(groups, collections), [groups, collections])

  const filteredRoots = useMemo(() => {
    if (!search.trim()) return roots
    const q = search.toLowerCase()
    function filterNode(node: GroupNode): GroupNode | null {
      const filteredCols = node.collections.filter((c) => c.name.toLowerCase().includes(q))
      const filteredChildren = node.children.map(filterNode).filter(Boolean) as GroupNode[]
      if (filteredCols.length === 0 && filteredChildren.length === 0) return null
      return { ...node, collections: filteredCols, children: filteredChildren }
    }
    return roots.map(filterNode).filter(Boolean) as GroupNode[]
  }, [roots, search])

  const filteredUngrouped = useMemo(() => {
    if (!search.trim()) return ungrouped
    return ungrouped.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
  }, [ungrouped, search])

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const handleSelect = (col: Collection) => { selectNode(col.id); if (location.pathname !== '/') navigate('/') }

  // ─── 拖拽逻辑 ──────────────────
  const handleDragStart = (event: DragStartEvent) => { setActiveId(event.active.id as string) }

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeData = active.data.current
    const overData = over.data.current
    // 只有 collection 拖到 group 上时才展开（group 拖 group 不展开）
    if (activeData?.type === 'collection' && overData?.type === 'group') {
      setExpanded((prev) => new Set(prev).add(over.id as string))
    }
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeData = active.data.current
    const overData = over.data.current
    const store = useCollectionStore.getState()

    // Group 排序 — optimistic update
    if (activeData?.type === 'group' && overData?.type === 'group') {
      const topGroups = store.groups.filter((g) => !g.parent_id).sort((a, b) => a.sort_order - b.sort_order)
      const oldIdx = topGroups.findIndex((g) => g.id === active.id)
      const newIdx = topGroups.findIndex((g) => g.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return
      const reordered = [...topGroups]
      const [moved] = reordered.splice(oldIdx, 1)
      reordered.splice(newIdx, 0, moved)

      // 立即更新前端 state（无回弹）
      const updatedGroups = store.groups.map((g) => {
        const idx = reordered.findIndex((r) => r.id === g.id)
        return idx !== -1 ? { ...g, sort_order: idx } : g
      })
      useCollectionStore.setState({ groups: updatedGroups })

      // 异步保存到后端
      const groupOrders = reordered.map((g, i) => ({ id: g.id, sort_order: i }))
      invoke('reorder_sidebar', { groups: groupOrders, collections: [] }).catch(console.error)
      return
    }

    // Collection 排序 — optimistic update
    if (activeData?.type === 'collection') {
      const activeCol = store.collections.find((c) => c.id === active.id)
      if (!activeCol) return

      let targetGroupId: string | null = null
      if (overData?.type === 'collection') {
        targetGroupId = overData.groupId as string
      } else if (overData?.type === 'group') {
        targetGroupId = over.id as string
      }
      if (targetGroupId === undefined) targetGroupId = activeCol.group_id

      const targetCols = store.collections
        .filter((c) => c.group_id === targetGroupId && c.id !== active.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

      if (overData?.type === 'group') {
        targetCols.unshift(activeCol)
      } else {
        const overIdx = targetCols.findIndex((c) => c.id === over.id)
        if (overIdx !== -1) {
          targetCols.splice(overIdx + 1, 0, activeCol)
        } else {
          targetCols.push(activeCol)
        }
      }

      // 立即更新前端 state（无回弹）
      const orderMap = new Map(targetCols.map((c, i) => [c.id, i]))
      const updatedCollections = store.collections.map((c) => {
        if (c.id === active.id) return { ...c, group_id: targetGroupId, sort_order: orderMap.get(c.id) ?? c.sort_order }
        if (orderMap.has(c.id)) return { ...c, sort_order: orderMap.get(c.id)! }
        return c
      })
      useCollectionStore.setState({ collections: updatedCollections })

      // 异步保存到后端
      const colOrders = targetCols.map((c, i) => ({ id: c.id, group_id: targetGroupId, sort_order: i }))
      invoke('reorder_sidebar', { groups: [], collections: colOrders }).catch(console.error)
    }
  }, [])

  // ─── 菜单操作 ───
  const openGroupMenu = (e: React.MouseEvent, groupId: string) => { e.stopPropagation(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: rect.right + 4, y: rect.top, target: 'group', groupId }) }
  const openColMenu = (e: React.MouseEvent, col: Collection) => { e.stopPropagation(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: rect.right + 4, y: rect.top, target: 'col', col }) }

  const handleGroupAddSuite = () => { if (!menu?.groupId) return; setInlineInput({ parentGroupId: menu.groupId, type: 'suite' }); setInlineValue(t('common.new_test_suite')); setExpanded((prev) => new Set(prev).add(menu.groupId!)); setMenu(null) }
  const handleGroupAddSubGroup = () => { if (!menu?.groupId) return; setInlineInput({ parentGroupId: menu.groupId, type: 'group' }); setInlineValue(''); setExpanded((prev) => new Set(prev).add(menu.groupId!)); setMenu(null) }

  const commitInline = async () => {
    if (!inlineInput) return
    const name = inlineValue.trim(); setInlineInput(null)
    if (!name) return
    if (inlineInput.type === 'suite') {
      await createCollection(name, '', inlineInput.parentGroupId)
      const updated = useCollectionStore.getState().collections
      const created = updated.find((c) => c.name === name && c.group_id === inlineInput.parentGroupId)
      if (created) { setRenamingId(created.id); setRenameValue(created.name) }
    } else {
      const newGroup = await createGroup(name, inlineInput.parentGroupId)
      setExpanded((prev) => new Set(prev).add(newGroup.id))
    }
  }

  const handleGroupRunAll = async () => {
    if (!menu?.groupId) return
    const groupId = menu.groupId; setMenu(null)
    const cols = collections.filter((c) => c.group_id === groupId)
    for (const col of cols) { try { await invoke('run_collection', { collectionId: col.id, concurrency: 5 }) } catch (e) { console.error(`运行集合 ${col.name} 失败:`, e) } }
    if (cols.length > 0) handleSelect(cols[0])
  }

  const handleGroupRename = () => { if (!menu?.groupId) return; const group = groups.find((g) => g.id === menu.groupId); if (!group) return; setRenamingId(menu.groupId); setRenameValue(group.name); setMenu(null) }
  const handleGroupDelete = async () => {
    if (!menu?.groupId) return
    const groupId = menu.groupId; setMenu(null)
    const group = groups.find((g) => g.id === groupId)
    const cols = collections.filter((c) => c.group_id === groupId)
    const ok = await confirm(t('common.confirm_delete_group', { name: group?.name ?? '' }), { title: t('group_menu.delete'), kind: 'warning' })
    if (!ok) return
    for (const col of cols) { await deleteCollection(col.id) }
    await deleteGroup(groupId)
  }

  const handleColAddCase = async () => { if (!menu?.col) return; const col = menu.col; setMenu(null); await invoke('create_item', { collectionId: col.id, parentId: null, itemType: 'request', name: t('common.new_test_case'), method: 'POST' }); await loadTree(col.id); handleSelect(col) }
  const handleColRename = () => { if (!menu?.col) return; setRenamingId(menu.col.id); setRenameValue(menu.col.name); setMenu(null) }
  const handleColDelete = async () => { if (!menu?.col) return; const name = menu.col.name; setMenu(null); const ok = await confirm(t('common.confirm_delete', { name }), { title: t('common.delete'), kind: 'warning' }); if (!ok) return; await deleteCollection(menu.col.id) }
  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    const group = groups.find((g) => g.id === renamingId)
    if (group) { await updateGroup(renamingId, renameValue.trim()) } else { await renameCollection(renamingId, renameValue.trim()) }
    setRenamingId(null)
  }

  const handleNewTopGroup = () => { setNewTopGroup(true); setNewTopValue('') }
  const commitTopGroup = async () => { const name = newTopValue.trim(); setNewTopGroup(false); if (!name) return; const newGroup = await createGroup(name); setExpanded((prev) => new Set(prev).add(newGroup.id)) }

  // 拖拽中的 overlay 内容
  const activeGroup = activeId ? groups.find((g) => g.id === activeId) : null
  const activeCol = activeId ? collections.find((c) => c.id === activeId) : null

  // 顶级 group IDs（用于 SortableContext）
  const topGroupIds = filteredRoots.map((n) => n.group.id)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* 顶部拖拽区域 + Logo */}
      <div className="pt-9 px-4 pb-3" data-tauri-drag-region="">
        <div className="flex items-center gap-2" data-tauri-drag-region="">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <defs><linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="oklch(0.7 0.2 240)" /><stop offset="100%" stopColor="oklch(0.6 0.22 280)" /></linearGradient></defs>
            <path d="M13 2L4.094 12.688c-.15.187-.225.281-.226.36a.25.25 0 00.098.205c.063.047.178.047.407.047H12l-1 8.7 8.906-10.688c.15-.187.226-.281.226-.36a.25.25 0 00-.097-.205c-.064-.047-.179-.047-.408-.047H12l1-8.7z" fill="url(#logo-grad)" fillOpacity="0.9" />
          </svg>
          <span className="text-sm font-semibold text-gradient tracking-tight">QAI</span>
          <span className="text-[9px] text-muted-foreground/40 font-medium ml-0.5">v0.1</span>
        </div>
      </div>

      <div className="px-2.5 pb-2.5 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('sidebar.search')} autoComplete="off" className="w-full h-7 pl-8 pr-2 rounded-lg bg-overlay/[0.04] text-xs placeholder:text-muted-foreground/40 border border-overlay/[0.06] outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all" />
        </div>
        <button onClick={handleNewTopGroup} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-overlay/[0.06] cursor-pointer transition-colors" title={t('sidebar.new_group')}>
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto px-2.5">
          <SortableContext items={topGroupIds} strategy={verticalListSortingStrategy}>
            {filteredRoots.map((node) => (
              <SortableGroupRow key={node.group.id} id={node.group.id}>
                <GroupTreeNode node={node} level={0} expanded={expanded} selectedNodeId={selectedNodeId} renamingId={renamingId} renameValue={renameValue} inlineInput={inlineInput} inlineValue={inlineValue} onToggle={toggle} onSelect={handleSelect} onGroupMenu={openGroupMenu} onColMenu={openColMenu} onRenameChange={setRenameValue} onRenameCommit={commitRename} onRenameCancel={() => setRenamingId(null)} onInlineChange={setInlineValue} onInlineCommit={commitInline} onInlineCancel={() => setInlineInput(null)} />
              </SortableGroupRow>
            ))}
          </SortableContext>

          {/* 未分组 */}
          {filteredUngrouped.map((col) => {
            const isSelected = selectedNodeId === col.id
            const isRenaming = renamingId === col.id
            return (
              <div key={col.id} className={`group/item flex items-center gap-1 py-1.5 pr-1 text-xs rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:bg-overlay/[0.04] hover:text-foreground'}`} style={{ paddingLeft: '20px' }} onClick={() => !isRenaming && handleSelect(col)}>
                {isRenaming ? (
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }} className="h-5 text-xs flex-1 py-0 px-1" autoFocus onClick={(e) => e.stopPropagation()} />
                ) : (
                  <>
                    <span className="flex-1 text-left truncate">{col.name}</span>
                    <button className="shrink-0 p-0.5 rounded opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-opacity" onClick={(e) => openColMenu(e, col)}><MoreHorizontal className="h-3.5 w-3.5" /></button>
                    <Circle className="h-2 w-2 shrink-0 fill-muted-foreground/20 text-muted-foreground/20" />
                  </>
                )}
              </div>
            )
          })}

          {newTopGroup && (
            <div className="px-2 py-1">
              <Input value={newTopValue} onChange={(e) => setNewTopValue(e.target.value)} onBlur={commitTopGroup} onKeyDown={(e) => { if (e.key === 'Enter') commitTopGroup(); if (e.key === 'Escape') setNewTopGroup(false) }} placeholder="分组名称" className="h-6 text-[10px] font-bold uppercase tracking-wider px-2" autoFocus />
            </div>
          )}

          {roots.length === 0 && ungrouped.length === 0 && !newTopGroup && (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <p className="text-sm text-muted-foreground">{t('sidebar.no_suites')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('sidebar.no_suites_hint')}</p>
            </div>
          )}
        </div>

        {/* 拖拽浮层 */}
        <DragOverlay>
          {activeGroup && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-card text-[10px] font-semibold tracking-wider text-muted-foreground uppercase shadow-lg">
              <GripVertical className="h-3 w-3" /> {activeGroup.name}
            </div>
          )}
          {activeCol && (
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg glass-card text-xs shadow-lg">
              <GripVertical className="h-3 w-3 text-muted-foreground" /> {activeCol.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* 弹出菜单 */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.target === 'group' && (
            <>
              <button className={menuItemClass} onClick={handleGroupAddSuite}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.new_suite')}</button>
              <button className={menuItemClass} onClick={handleGroupAddSubGroup}><FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.new_subgroup')}</button>
              <button className={menuItemClass} onClick={handleGroupRunAll}><Play className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.run_all')}</button>
              <div className={menuDividerClass} />
              <button className={menuItemClass} onClick={handleGroupRename}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.rename')}</button>
              <button className={menuDangerClass} onClick={handleGroupDelete}><Trash2 className="h-3.5 w-3.5" /> {t('group_menu.delete')}</button>
            </>
          )}
          {menu.target === 'col' && (
            <>
              <button className={menuItemClass} onClick={handleColAddCase}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> {t('collection_menu.add_case')}</button>
              <button className={menuItemClass} onClick={() => { if (menu.col) { handleSelect(menu.col); setMenu(null) } }}><Play className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.run_all')}</button>
              <div className={menuDividerClass} />
              <button className={menuItemClass} onClick={handleColRename}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /> {t('group_menu.rename')}</button>
              <button className={menuDangerClass} onClick={handleColDelete}><Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}</button>
            </>
          )}
        </ContextMenu>
      )}

      <div className="border-t border-overlay/[0.06] px-2.5 py-2.5 flex items-center gap-1.5">
        {NAV_ITEMS.map((item) => { const Icon = item.icon; const isActive = location.pathname === item.path; return (
          <button key={item.path} onClick={() => navigate(item.path)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg cursor-pointer transition-all duration-200 ${isActive ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'}`}>
            <Icon className="h-3.5 w-3.5" /><span className="text-[10px] font-medium">{t(item.labelKey)}</span>
          </button>
        ) })}
      </div>
    </div>
  )
}

// ─── 递归分组节点 ──────────────────────
interface GroupTreeNodeProps {
  node: GroupNode; level: number; expanded: Set<string>; selectedNodeId: string | null
  renamingId: string | null; renameValue: string
  inlineInput: { parentGroupId: string; type: 'group' | 'suite' } | null; inlineValue: string
  onToggle: (id: string) => void; onSelect: (col: Collection) => void
  onGroupMenu: (e: React.MouseEvent, groupId: string) => void; onColMenu: (e: React.MouseEvent, col: Collection) => void
  onRenameChange: (v: string) => void; onRenameCommit: () => void; onRenameCancel: () => void
  onInlineChange: (v: string) => void; onInlineCommit: () => void; onInlineCancel: () => void
}

function GroupTreeNode(props: GroupTreeNodeProps) {
  const { t } = useTranslation()
  const { node, level, expanded, selectedNodeId, renamingId, renameValue, inlineInput, inlineValue, onToggle, onSelect, onGroupMenu, onColMenu, onRenameChange, onRenameCommit, onRenameCancel, onInlineChange, onInlineCommit, onInlineCancel } = props
  const isExpanded = expanded.has(node.group.id)
  const total = countAll(node)
  const isRenaming = renamingId === node.group.id

  const collectionIds = node.collections.map((c) => c.id)

  return (
    <div className="mb-0.5">
      <div className="group/cat flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-overlay/[0.04] rounded-lg cursor-pointer transition-all duration-150" style={{ paddingLeft: `${level * 12 + 8}px` }} onClick={() => onToggle(node.group.id)}>
        {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
        {isRenaming ? (
          <Input value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onBlur={onRenameCommit} onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }} className="h-5 text-[10px] font-bold uppercase tracking-wider flex-1 py-0 px-1" autoFocus onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase flex-1">{node.group.name}</span>
        )}
        <button className="shrink-0 p-0.5 rounded-md opacity-0 group-hover/cat:opacity-100 text-muted-foreground hover:text-foreground cursor-pointer transition-opacity" onClick={(e) => onGroupMenu(e, node.group.id)}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <span className="bg-overlay/[0.06] text-muted-foreground text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium">{total}</span>
      </div>

      {isExpanded && (
        <>
          {node.children.map((child) => <GroupTreeNode key={child.group.id} {...props} node={child} level={level + 1} />)}

          <SortableContext items={collectionIds} strategy={verticalListSortingStrategy}>
            {node.collections.map((col) => {
              const isSelected = selectedNodeId === col.id
              const isColRenaming = renamingId === col.id
              return (
                <SortableCollectionRow key={col.id} id={col.id} groupId={node.group.id}>
                  <div className={`group/item flex items-center gap-1 py-1.5 pr-1 text-xs rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:bg-overlay/[0.04] hover:text-foreground'}`} style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} onClick={() => !isColRenaming && onSelect(col)}>
                    {isColRenaming ? (
                      <Input value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onBlur={onRenameCommit} onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }} className="h-5 text-xs flex-1 py-0 px-1" autoFocus onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <>
                        <span className="flex-1 text-left truncate">{col.name}</span>
                        <button className="shrink-0 p-0.5 rounded opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-opacity" onClick={(e) => onColMenu(e, col)}>
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                        <Circle className="h-2 w-2 shrink-0 fill-muted-foreground/20 text-muted-foreground/20" />
                      </>
                    )}
                  </div>
                </SortableCollectionRow>
              )
            })}
          </SortableContext>

          {inlineInput && inlineInput.parentGroupId === node.group.id && (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} className="pr-2 py-1">
              <Input value={inlineValue} onChange={(e) => onInlineChange(e.target.value)} onBlur={onInlineCommit} onKeyDown={(e) => { if (e.key === 'Enter') onInlineCommit(); if (e.key === 'Escape') onInlineCancel() }} placeholder={inlineInput.type === 'suite' ? t('common.suite_name_placeholder') : t('common.subgroup_name_placeholder')} className="h-5 text-xs py-0 px-1" autoFocus />
            </div>
          )}
        </>
      )}
    </div>
  )
}
