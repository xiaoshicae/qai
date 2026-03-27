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
import type { Collection } from '@/types'

const NAV_ITEMS = [
  { path: '/history', label: '历史', icon: History },
  { path: '/environments', label: '环境', icon: Globe },
  { path: '/settings', label: '设置', icon: Settings },
]

// ─── 分组树节点 ─────────────────
interface CatNode {
  name: string
  fullPath: string
  children: CatNode[]
  collections: Collection[]
}

function buildCategoryTree(collections: Collection[], categoryOrder: string[] | null): CatNode[] {
  const order = categoryOrder ?? []
  const nodeMap = new Map<string, CatNode>()

  function ensureNode(path: string): CatNode {
    if (nodeMap.has(path)) return nodeMap.get(path)!
    const parts = path.split('/')
    const name = parts[parts.length - 1] || 'other'
    const node: CatNode = { name, fullPath: path, children: [], collections: [] }
    nodeMap.set(path, node)
    if (parts.length > 1) {
      const parent = ensureNode(parts.slice(0, -1).join('/'))
      if (!parent.children.find((c) => c.fullPath === path)) parent.children.push(node)
    }
    return node
  }

  // 先按 order 创建节点（保证顺序）
  for (const path of order) ensureNode(path)
  // 再处理 collections 里的 category（可能有不在 order 里的）
  for (const col of collections) ensureNode((col.category || 'other').toLowerCase())
  // 挂载 collections
  for (const col of collections) {
    const cat = (col.category || 'other').toLowerCase()
    nodeMap.get(cat)!.collections.push(col)
  }

  // 按 categoryOrder 排序根节点
  const rootPaths = [...new Set([...order.map((p) => p.split('/')[0]), ...[...nodeMap.keys()].filter((k) => !k.includes('/'))])]
  const seen = new Set<string>()
  const root: CatNode[] = []
  for (const p of rootPaths) {
    if (seen.has(p)) continue
    seen.add(p)
    const node = nodeMap.get(p)
    if (node) root.push(node)
  }
  return root
}

function countAll(node: CatNode): number {
  return node.collections.length + node.children.reduce((s, c) => s + countAll(c), 0)
}

// ─── 分组顺序持久化 ─────────────────
async function loadCategoryOrder(): Promise<string[]> {
  try {
    const val = await invoke<string | null>('get_setting_cmd', { key: 'category_order' })
    if (!val) return []
    const parsed = JSON.parse(val)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

async function saveCategoryOrder(order: string[]) {
  await invoke('save_setting', { key: 'category_order', value: JSON.stringify(order) })
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const confirm = useConfirmStore((s) => s.confirm)
  const { collections, selectedNodeId, loadCollections, createCollection, deleteCollection, renameCollection, selectNode, loadTree } = useCollectionStore()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [categoryOrder, setCategoryOrder] = useState<string[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; target: 'cat' | 'col'; catPath?: string; col?: Collection } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [inlineInput, setInlineInput] = useState<{ parentPath: string; type: 'group' | 'suite' } | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const [newTopGroup, setNewTopGroup] = useState(false)
  const [newTopValue, setNewTopValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const [orderLoaded, setOrderLoaded] = useState(false)
  useEffect(() => {
    loadCollections()
    loadCategoryOrder().then((o) => { setCategoryOrder(o); setOrderLoaded(true) })
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const initializedRef = useRef(false)
  // 初始展开所有一级（仅首次） + 同步 categoryOrder
  useEffect(() => {
    if (!orderLoaded) return
    // 仅首次加载时展开所有一级
    if (!initializedRef.current && collections.length > 0) {
      initializedRef.current = true
      const cats = new Set(collections.map((c) => (c.category || 'other').toLowerCase().split('/')[0]))
      setExpanded((prev) => new Set([...prev, ...cats]))
    }
    // 补充数据库中新出现的 category 到 order 末尾
    const allCats: string[] = []
    const seen = new Set<string>()
    for (const c of [...collections].reverse()) {
      const cat = (c.category || 'other').toLowerCase()
      if (!seen.has(cat)) { seen.add(cat); allCats.push(cat) }
    }
    setCategoryOrder((prev) => {
      const merged = [...(prev ?? [])]
      let changed = false
      for (const c of allCats) {
        if (!merged.includes(c)) { merged.push(c); changed = true }
      }
      // 持久化到 DB，这样重启后顺序一致
      if (changed) saveCategoryOrder(merged)
      return merged
    })
  }, [collections, orderLoaded])

  const tree = useMemo(() => buildCategoryTree(collections, categoryOrder), [collections, categoryOrder])

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree
    const q = search.toLowerCase()
    function filterNode(node: CatNode): CatNode | null {
      const filteredCols = node.collections.filter((c) => c.name.toLowerCase().includes(q))
      const filteredChildren = node.children.map(filterNode).filter(Boolean) as CatNode[]
      if (filteredCols.length === 0 && filteredChildren.length === 0) return null
      return { ...node, collections: filteredCols, children: filteredChildren }
    }
    return tree.map(filterNode).filter(Boolean) as CatNode[]
  }, [tree, search])

  const toggle = (path: string) => setExpanded((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })
  const handleSelect = (col: Collection) => { selectNode(col.id); if (location.pathname !== '/') navigate('/') }

  // ─── 菜单操作 ───
  const openCatMenu = (e: React.MouseEvent, catPath: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: rect.right + 4, y: rect.top, target: 'cat', catPath })
  }
  const openColMenu = (e: React.MouseEvent, col: Collection) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: rect.right + 4, y: rect.top, target: 'col', col })
  }

  const handleCatAddSuite = () => {
    if (!menu?.catPath) return
    setInlineInput({ parentPath: menu.catPath, type: 'suite' })
    setInlineValue('新测试集')
    setExpanded((prev) => new Set(prev).add(menu.catPath!))
    setMenu(null)
  }
  const handleCatAddGroup = () => {
    if (!menu?.catPath) return
    setInlineInput({ parentPath: menu.catPath, type: 'group' })
    setInlineValue('')
    setExpanded((prev) => new Set(prev).add(menu.catPath!))
    setMenu(null)
  }

  const commitInline = async () => {
    if (!inlineInput) return
    const name = inlineValue.trim()
    setInlineInput(null)
    if (!name) return

    if (inlineInput.type === 'suite') {
      await createCollection(name, '', inlineInput.parentPath)
      const updated = useCollectionStore.getState().collections
      const created = updated.find((c) => c.name === name && (c.category || '').toLowerCase() === inlineInput.parentPath)
      if (created) { setRenamingId(created.id); setRenameValue(created.name) }
    } else {
      // 子分组：只注册路径，不创建集合
      const subPath = `${inlineInput.parentPath}/${name.toLowerCase()}`
      const newOrder = [...categoryOrder, subPath]
      setCategoryOrder(newOrder)
      await saveCategoryOrder(newOrder)
      setExpanded((prev) => new Set(prev).add(subPath))
    }
  }

  // 运行分组下所有测试集
  const handleCatRunAll = async () => {
    if (!menu?.catPath) return
    const catPath = menu.catPath; setMenu(null)
    // 找到该分组下的所有集合，逐个运行
    const cols = collections.filter((c) => (c.category || '').toLowerCase().startsWith(catPath))
    for (const col of cols) {
      try { await invoke('run_collection', { collectionId: col.id, concurrency: 5 }) } catch {}
    }
    // 选中第一个看结果
    if (cols.length > 0) handleSelect(cols[0])
  }

  // 删除分组及其下所有测试集
  const handleCatDelete = async () => {
    if (!menu?.catPath) return
    const catPath = menu.catPath; setMenu(null)
    const cols = collections.filter((c) => (c.category || '').toLowerCase().startsWith(catPath))
    const ok = await confirm(`确定删除分组「${catPath.toUpperCase()}」及其下 ${cols.length} 个测试集？此操作不可撤销。`, { title: '删除分组', kind: 'warning' })
    if (!ok) return
    for (const col of cols) { await deleteCollection(col.id) }
    // 从 order 中移除
    const newOrder = categoryOrder.filter((p) => !p.startsWith(catPath))
    setCategoryOrder(newOrder)
    await saveCategoryOrder(newOrder)
  }

  const handleColAddCase = async () => {
    if (!menu?.col) return
    const col = menu.col; setMenu(null)
    await invoke('create_request', { collectionId: col.id, folderId: null, name: '新测试用例', method: 'POST' })
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
  const commitRename = async () => { if (renamingId && renameValue.trim()) await renameCollection(renamingId, renameValue.trim()); setRenamingId(null) }

  // 新建顶级分组
  const handleNewTopGroup = () => { setNewTopGroup(true); setNewTopValue('') }
  const commitTopGroup = async () => {
    const name = newTopValue.trim()
    setNewTopGroup(false)
    if (!name) return
    const key = name.toLowerCase()
    const newOrder = [...categoryOrder, key]
    setCategoryOrder(newOrder)
    await saveCategoryOrder(newOrder)
    setExpanded((prev) => new Set(prev).add(key))
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
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索..." className="w-full h-7 pl-8 pr-2 rounded-lg bg-white/[0.04] text-xs placeholder:text-muted-foreground/40 border border-white/[0.06] outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all" />
        </div>
        <button onClick={handleNewTopGroup} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] cursor-pointer transition-colors" title="新建分组">
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5">
        {filteredTree.map((node) => (
          <CategoryNode key={node.fullPath} node={node} level={0} expanded={expanded} selectedNodeId={selectedNodeId} renamingId={renamingId} renameValue={renameValue} inlineInput={inlineInput} inlineValue={inlineValue} onToggle={toggle} onSelect={handleSelect} onCatMenu={openCatMenu} onColMenu={openColMenu} onRenameChange={setRenameValue} onRenameCommit={commitRename} onRenameCancel={() => setRenamingId(null)} onInlineChange={setInlineValue} onInlineCommit={commitInline} onInlineCancel={() => setInlineInput(null)} />
        ))}

        {newTopGroup && (
          <div className="px-2 py-1">
            <Input value={newTopValue} onChange={(e) => setNewTopValue(e.target.value)} onBlur={commitTopGroup} onKeyDown={(e) => { if (e.key === 'Enter') commitTopGroup(); if (e.key === 'Escape') setNewTopGroup(false) }} placeholder="分组名称" className="h-6 text-[10px] font-bold uppercase tracking-wider px-2" autoFocus />
          </div>
        )}

        {tree.length === 0 && !newTopGroup && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4">
            <p className="text-sm text-muted-foreground">暂无测试集</p>
            <p className="text-xs text-muted-foreground/60 mt-1">点击 + 创建分组</p>
          </div>
        )}
      </div>

      {/* 弹出菜单 */}
      {menu && (
        <div ref={menuRef} className="fixed z-50 min-w-[160px] rounded-xl glass-card p-1.5 shadow-2xl" style={{ left: menu.x, top: menu.y }}>
          {menu.target === 'cat' && (
            <>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={handleCatAddSuite}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> 新建测试集</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={handleCatAddGroup}><FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> 新建子分组</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={handleCatRunAll}><Play className="h-3.5 w-3.5 text-muted-foreground" /> 运行全部</button>
              <div className="h-px bg-white/[0.06] my-1" />
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/10 cursor-pointer transition-colors" onClick={handleCatDelete}><Trash2 className="h-3.5 w-3.5" /> 删除分组</button>
            </>
          )}
          {menu.target === 'col' && (
            <>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={handleColAddCase}><FilePlus className="h-3.5 w-3.5 text-muted-foreground" /> 添加测试用例</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={() => { if (menu.col) { handleSelect(menu.col); setMenu(null) } }}><Play className="h-3.5 w-3.5 text-muted-foreground" /> 运行全部</button>
              <div className="h-px bg-white/[0.06] my-1" />
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs hover:bg-white/[0.06] cursor-pointer transition-colors" onClick={handleColRename}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /> 重命名</button>
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/10 cursor-pointer transition-colors" onClick={handleColDelete}><Trash2 className="h-3.5 w-3.5" /> 删除</button>
            </>
          )}
        </div>
      )}

      <div className="border-t border-white/[0.06] px-2 py-2.5 flex items-center gap-1.5">
        {NAV_ITEMS.map((item) => { const Icon = item.icon; const isActive = location.pathname === item.path; return (
          <button key={item.path} onClick={() => navigate(item.path)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl cursor-pointer transition-all duration-200 ${isActive ? 'bg-white/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'}`}>
            <Icon className="h-3.5 w-3.5" /><span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ) })}
      </div>
    </div>
  )
}

// ─── 递归分组节点 ──────────────────────
interface CategoryNodeProps {
  node: CatNode; level: number; expanded: Set<string>; selectedNodeId: string | null
  renamingId: string | null; renameValue: string
  inlineInput: { parentPath: string; type: 'group' | 'suite' } | null; inlineValue: string
  onToggle: (path: string) => void; onSelect: (col: Collection) => void
  onCatMenu: (e: React.MouseEvent, path: string) => void; onColMenu: (e: React.MouseEvent, col: Collection) => void
  onRenameChange: (v: string) => void; onRenameCommit: () => void; onRenameCancel: () => void
  onInlineChange: (v: string) => void; onInlineCommit: () => void; onInlineCancel: () => void
}

function CategoryNode(props: CategoryNodeProps) {
  const { node, level, expanded, selectedNodeId, renamingId, renameValue, inlineInput, inlineValue, onToggle, onSelect, onCatMenu, onColMenu, onRenameChange, onRenameCommit, onRenameCancel, onInlineChange, onInlineCommit, onInlineCancel } = props
  const isExpanded = expanded.has(node.fullPath)
  const total = countAll(node)

  return (
    <div className="mb-0.5">
      <div className="group/cat flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-white/[0.04] rounded-lg cursor-pointer transition-all duration-150" style={{ paddingLeft: `${level * 12 + 8}px` }} onClick={() => onToggle(node.fullPath)}>
        {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase flex-1">{node.name}</span>
        <button className="shrink-0 p-0.5 rounded-md opacity-0 group-hover/cat:opacity-100 text-muted-foreground hover:text-foreground cursor-pointer transition-opacity" onClick={(e) => onCatMenu(e, node.fullPath)}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <span className="bg-white/[0.06] text-muted-foreground text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium">{total}</span>
      </div>

      {isExpanded && (
        <>
          {node.children.map((child) => <CategoryNode key={child.fullPath} {...props} node={child} level={level + 1} />)}

          {node.collections.map((col) => {
            const isSelected = selectedNodeId === col.id
            const isRenaming = renamingId === col.id
            return (
              <div key={col.id} className={`group/item flex items-center gap-1 py-1.5 pr-1 text-xs rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? 'bg-white/[0.08] text-foreground glow-ring' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'}`} style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} onClick={() => !isRenaming && onSelect(col)}>
                {isRenaming ? (
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

          {inlineInput && inlineInput.parentPath === node.fullPath && (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} className="pr-2 py-1">
              <Input value={inlineValue} onChange={(e) => onInlineChange(e.target.value)} onBlur={onInlineCommit} onKeyDown={(e) => { if (e.key === 'Enter') onInlineCommit(); if (e.key === 'Escape') onInlineCancel() }} placeholder={inlineInput.type === 'suite' ? '测试集名称' : '子分组名称'} className="h-5 text-xs py-0 px-1" autoFocus />
            </div>
          )}
        </>
      )}
    </div>
  )
}
