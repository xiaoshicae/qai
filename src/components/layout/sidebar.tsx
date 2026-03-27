import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import {
  Search, Plus, History, Globe, Settings, Circle,
  ChevronDown, ChevronRight, MoreHorizontal,
  FilePlus, FolderPlus, Play, Pencil, Trash2,
} from 'lucide-react'
import { useCollectionStore } from '@/stores/collection-store'
import { Input } from '@/components/ui/input'
import type { Collection, Group } from '@/types'

const NAV_ITEMS = [
  { path: '/history', label: '历史', icon: History },
  { path: '/environments', label: '环境', icon: Globe },
  { path: '/settings', label: '设置', icon: Settings },
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
  // 构建父子关系
  const roots: GroupNode[] = []
  for (const g of groups) {
    const node = nodeMap.get(g.id)!
    if (g.parent_id && nodeMap.has(g.parent_id)) {
      nodeMap.get(g.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // 挂载 collections
  const ungrouped: Collection[] = []
  for (const col of collections) {
    if (col.group_id && nodeMap.has(col.group_id)) {
      nodeMap.get(col.group_id)!.collections.push(col)
    } else {
      ungrouped.push(col)
    }
  }
  // 按 sort_order 排序
  roots.sort((a, b) => a.group.sort_order - b.group.sort_order)
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.group.sort_order - b.group.sort_order)
  }
  return { roots, ungrouped }
}

function countAll(node: GroupNode): number {
  return node.collections.length + node.children.reduce((s, c) => s + countAll(c), 0)
}

export default function Sidebar() {
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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadCollections()
    loadGroups()
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const initializedRef = useRef(false)
  // 初始展开所有一级（仅首次）
  useEffect(() => {
    if (!initializedRef.current && groups.length > 0) {
      initializedRef.current = true
      const groupIds = new Set(groups.filter((g) => !g.parent_id).map((g) => g.id))
      setExpanded((prev) => new Set([...prev, ...groupIds]))
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
    const q = search.toLowerCase()
    return ungrouped.filter((c) => c.name.toLowerCase().includes(q))
  }, [ungrouped, search])

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const handleSelect = (col: Collection) => { selectNode(col.id); if (location.pathname !== '/') navigate('/') }

  // ─── 菜单操作 ───
  const openGroupMenu = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: rect.right + 4, y: rect.top, target: 'group', groupId })
  }
  const openColMenu = (e: React.MouseEvent, col: Collection) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: rect.right + 4, y: rect.top, target: 'col', col })
  }

  const handleGroupAddSuite = () => {
    if (!menu?.groupId) return
    setInlineInput({ parentGroupId: menu.groupId, type: 'suite' })
    setInlineValue('新测试集')
    setExpanded((prev) => new Set(prev).add(menu.groupId!))
    setMenu(null)
  }
  const handleGroupAddSubGroup = () => {
    if (!menu?.groupId) return
    setInlineInput({ parentGroupId: menu.groupId, type: 'group' })
    setInlineValue('')
    setExpanded((prev) => new Set(prev).add(menu.groupId!))
    setMenu(null)
  }

  const commitInline = async () => {
    if (!inlineInput) return
    const name = inlineValue.trim()
    setInlineInput(null)
    if (!name) return

    if (inlineInput.type === 'suite') {
      await createCollection(name, '', inlineInput.parentGroupId)
      const updated = useCollectionStore.getState().collections
      const created = updated.find((c) => c.name === name && c.group_id === inlineInput.parentGroupId)
      if (created) { setRenamingId(created.id); setRenameValue(created.name) }
    } else {
      // 子分组
      const newGroup = await createGroup(name, inlineInput.parentGroupId)
      setExpanded((prev) => new Set(prev).add(newGroup.id))
    }
  }

  // 运行分组下所有测试集
  const handleGroupRunAll = async () => {
    if (!menu?.groupId) return
    const groupId = menu.groupId; setMenu(null)
    const cols = collections.filter((c) => c.group_id === groupId)
    for (const col of cols) {
      try { await invoke('run_collection', { collectionId: col.id, concurrency: 5 }) } catch {}
    }
    if (cols.length > 0) handleSelect(cols[0])
  }

  // 重命名分组
  const handleGroupRename = () => {
    if (!menu?.groupId) return
    const group = groups.find((g) => g.id === menu.groupId)
    if (!group) return
    setRenamingId(menu.groupId)
    setRenameValue(group.name)
    setMenu(null)
  }

  // 删除分组
  const handleGroupDelete = async () => {
    if (!menu?.groupId) return
    const groupId = menu.groupId; setMenu(null)
    const group = groups.find((g) => g.id === groupId)
    const cols = collections.filter((c) => c.group_id === groupId)
    const ok = await confirm(`确定删除分组「${group?.name ?? ''}」及其下 ${cols.length} 个测试集？此操作不可撤销。`, { title: '删除分组', kind: 'warning' })
    if (!ok) return
    for (const col of cols) { await deleteCollection(col.id) }
    await deleteGroup(groupId)
  }

  const handleColAddCase = async () => {
    if (!menu?.col) return
    const col = menu.col; setMenu(null)
    await invoke('create_item', { collectionId: col.id, parentId: null, itemType: 'request', name: '新测试用例', method: 'POST' })
    await loadTree(col.id); handleSelect(col)
  }
  const handleColRename = () => { if (!menu?.col) return; setRenamingId(menu.col.id); setRenameValue(menu.col.name); setMenu(null) }
  const handleColDelete = async () => {
    if (!menu?.col) return
    const name = menu.col.name; setMenu(null)
    const ok = await confirm(`确定删除「${name}」及其所有测试用例？此操作不可撤销。`, { title: '删除测试集', kind: 'warning' })
    if (!ok) return
    await deleteCollection(menu.col.id)
  }
  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    // 判断是 group 还是 collection
    const group = groups.find((g) => g.id === renamingId)
    if (group) {
      await updateGroup(renamingId, renameValue.trim())
    } else {
      await renameCollection(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  // 新建顶级分组
  const handleNewTopGroup = () => { setNewTopGroup(true); setNewTopValue('') }
  const commitTopGroup = async () => {
    const name = newTopValue.trim()
    setNewTopGroup(false)
    if (!name) return
    const newGroup = await createGroup(name)
    setExpanded((prev) => new Set(prev).add(newGroup.id))
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* 顶部拖拽区域 + Logo */}
      <div className="pt-9 px-4 pb-3" data-tauri-drag-region="">
        <div className="flex items-center gap-2" data-tauri-drag-region="">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="oklch(0.7 0.2 240)" />
                <stop offset="100%" stopColor="oklch(0.6 0.22 280)" />
              </linearGradient>
            </defs>
            <path d="M13 2L4.094 12.688c-.15.187-.225.281-.226.36a.25.25 0 00.098.205c.063.047.178.047.407.047H12l-1 8.7 8.906-10.688c.15-.187.226-.281.226-.36a.25.25 0 00-.097-.205c-.064-.047-.179-.047-.408-.047H12l1-8.7z" fill="url(#logo-grad)" fillOpacity="0.9" />
          </svg>
          <span className="text-sm font-semibold text-gradient tracking-tight">QAI</span>
          <span className="text-[9px] text-muted-foreground/40 font-medium ml-0.5">v0.1</span>
        </div>
      </div>

      <div className="px-3 pb-2.5 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索..." className="w-full h-7 pl-8 pr-2 rounded-lg bg-overlay/[0.04] text-xs placeholder:text-muted-foreground/40 border border-overlay/[0.06] outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all" />
        </div>
        <button onClick={handleNewTopGroup} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="新建分组">
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5">
        {filteredRoots.map((node) => (
          <GroupTreeNode key={node.group.id} node={node} level={0} expanded={expanded} selectedNodeId={selectedNodeId} renamingId={renamingId} renameValue={renameValue} inlineInput={inlineInput} inlineValue={inlineValue} onToggle={toggle} onSelect={handleSelect} onGroupMenu={openGroupMenu} onColMenu={openColMenu} onRenameChange={setRenameValue} onRenameCommit={commitRename} onRenameCancel={() => setRenamingId(null)} onInlineChange={setInlineValue} onInlineCommit={commitInline} onInlineCancel={() => setInlineInput(null)} />
        ))}

        {/* 未分组的 collections */}
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
                  <button className="shrink-0 p-0.5 rounded opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 cursor-pointer transition-opacity" onClick={(e) => openColMenu(e, col)}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
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
            <p className="text-sm text-muted-foreground">暂无测试集</p>
            <p className="text-xs text-muted-foreground/60 mt-1">点击 + 创建分组</p>
          </div>
        )}
      </div>

      {/* 弹出菜单 */}
      {menu && (
        <div ref={menuRef} className="fixed z-50 min-w-[160px] rounded-xl glass-card p-1.5 shadow-2xl" style={{ left: menu.x, top: menu.y }}>
          {menu.target === 'group' && (
            <>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleGroupAddSuite}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> 新建测试集</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleGroupAddSubGroup}><FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> 新建子分组</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleGroupRunAll}><Play className="h-3.5 w-3.5 text-muted-foreground" /> 运行全部</button>
              <div className="h-px bg-overlay/[0.06] my-1" />
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleGroupRename}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /> 重命名</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/10 cursor-pointer transition-colors" onClick={handleGroupDelete}><Trash2 className="h-3.5 w-3.5" /> 删除分组</button>
            </>
          )}
          {menu.target === 'col' && (
            <>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleColAddCase}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> 添加测试用例</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={() => { if (menu.col) { handleSelect(menu.col); setMenu(null) } }}><Play className="h-3.5 w-3.5 text-muted-foreground" /> 运行全部</button>
              <div className="h-px bg-overlay/[0.06] my-1" />
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] cursor-pointer transition-colors" onClick={handleColRename}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /> 重命名</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/10 cursor-pointer transition-colors" onClick={handleColDelete}><Trash2 className="h-3.5 w-3.5" /> 删除</button>
            </>
          )}
        </div>
      )}

      <div className="border-t border-overlay/[0.06] px-2 py-2.5 flex items-center gap-1.5">
        {NAV_ITEMS.map((item) => { const Icon = item.icon; const isActive = location.pathname === item.path; return (
          <button key={item.path} onClick={() => navigate(item.path)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl cursor-pointer transition-all duration-200 ${isActive ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'}`}>
            <Icon className="h-3.5 w-3.5" /><span className="text-[10px] font-medium">{item.label}</span>
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
  const { node, level, expanded, selectedNodeId, renamingId, renameValue, inlineInput, inlineValue, onToggle, onSelect, onGroupMenu, onColMenu, onRenameChange, onRenameCommit, onRenameCancel, onInlineChange, onInlineCommit, onInlineCancel } = props
  const isExpanded = expanded.has(node.group.id)
  const total = countAll(node)
  const isRenaming = renamingId === node.group.id

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

          {node.collections.map((col) => {
            const isSelected = selectedNodeId === col.id
            const isColRenaming = renamingId === col.id
            return (
              <div key={col.id} className={`group/item flex items-center gap-1 py-1.5 pr-1 text-xs rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? 'bg-overlay/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:bg-overlay/[0.04] hover:text-foreground'}`} style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} onClick={() => !isColRenaming && onSelect(col)}>
                {isColRenaming ? (
                  <Input value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onBlur={onRenameCommit} onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }} className="h-5 text-xs flex-1 py-0 px-1" autoFocus onClick={(e) => e.stopPropagation()} />
                ) : (
                  <>
                    <span className="flex-1 text-left truncate">{col.name}</span>
                    <button className="shrink-0 p-0.5 rounded opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 cursor-pointer transition-opacity" onClick={(e) => onColMenu(e, col)}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    <Circle className="h-2 w-2 shrink-0 fill-muted-foreground/20 text-muted-foreground/20" />
                  </>
                )}
              </div>
            )
          })}

          {inlineInput && inlineInput.parentGroupId === node.group.id && (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} className="pr-2 py-1">
              <Input value={inlineValue} onChange={(e) => onInlineChange(e.target.value)} onBlur={onInlineCommit} onKeyDown={(e) => { if (e.key === 'Enter') onInlineCommit(); if (e.key === 'Escape') onInlineCancel() }} placeholder={inlineInput.type === 'suite' ? '测试集名称' : '子分组名称'} className="h-5 text-xs py-0 px-1" autoFocus />
            </div>
          )}
        </>
      )}
    </div>
  )
}
