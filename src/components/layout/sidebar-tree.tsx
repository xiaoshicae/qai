import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MoreHorizontal, Circle } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Input } from '@/components/ui/input'
import type { Collection, Group } from '@/types'

// ─── 分组树结构 ──────────────────
export interface GroupNode {
  group: Group
  children: GroupNode[]
  collections: Collection[]
}

export function buildGroupTree(groups: Group[], collections: Collection[]): { roots: GroupNode[]; ungrouped: Collection[] } {
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

export function countAll(node: GroupNode): number {
  return node.collections.length + node.children.reduce((s, c) => s + countAll(c), 0)
}

// ─── 插入指示线 ──────────────────
function DropIndicator() {
  return (
    <div className="relative h-0 z-10">
      <div className="absolute left-3 right-3 top-0 h-[2px] bg-primary rounded-full" />
      <div className="absolute left-2 -top-[3px] h-2 w-2 rounded-full bg-primary" />
    </div>
  )
}

/** 顶级分组之间的间隙放置区 — 拖入时显示指示线，松手后提升为顶级分组 */
export function GapDropZone({ id, isActive }: { id: string; isActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'gap' } })
  return (
    <div ref={setNodeRef} className="relative" style={{ height: isActive ? 8 : 0, transition: 'height 150ms' }}>
      {isOver && <DropIndicator />}
    </div>
  )
}

// ─── 分组拖拽（只发起拖拽，drop 由 header 的 useDroppable 处理）──────
export function DraggableGroup({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { type: 'group' } })
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.15 : 1, transition: 'opacity 150ms' }} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

export function SortableCollectionRow({ id, groupId, overId, children }: { id: string; groupId: string; overId?: string | null; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id, data: { type: 'collection', groupId } })
  const showLine = !isDragging && overId === id
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.15 : 1, transition: 'opacity 150ms' }} {...attributes} {...listeners}>
      {showLine && <DropIndicator />}
      {children}
    </div>
  )
}

// ─── 递归分组树节点 ─────────────
export interface GroupTreeNodeProps {
  node: GroupNode; level: number; expanded: Set<string>; selectedNodeId: string | null
  renamingId: string | null; renameValue: string
  inlineInput: { parentGroupId: string; type: 'group' | 'suite' } | null; inlineValue: string
  overId?: string | null
  onToggle: (id: string) => void; onSelect: (col: Collection) => void
  onGroupMenu: (e: React.MouseEvent, groupId: string) => void; onColMenu: (e: React.MouseEvent, col: Collection) => void
  onRenameChange: (v: string) => void; onRenameCommit: () => void; onRenameCancel: () => void
  onInlineChange: (v: string) => void; onInlineCommit: () => void; onInlineCancel: () => void
}

export function GroupTreeNode(props: GroupTreeNodeProps) {
  const { t } = useTranslation()
  const { node, level, expanded, selectedNodeId, renamingId, renameValue, inlineInput, inlineValue, overId, onToggle, onSelect, onGroupMenu, onColMenu, onRenameChange, onRenameCommit, onRenameCancel, onInlineChange, onInlineCommit, onInlineCancel } = props
  const isExpanded = expanded.has(node.group.id)
  const total = countAll(node)
  const isRenaming = renamingId === node.group.id
  const collectionIds = node.collections.map((c) => c.id)

  // 分组 header 作为精准 drop target
  const { setNodeRef: headerDropRef, isOver: isHeaderOver } = useDroppable({
    id: node.group.id,
    data: { type: 'group' },
  })

  return (
    <div className="mb-0.5">
      <div ref={headerDropRef} className={`group/cat flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 ${isHeaderOver ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-overlay/[0.04]'}`} style={{ paddingLeft: `${level * 12 + 8}px` }} onClick={() => onToggle(node.group.id)}>
        {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
        {isRenaming ? (
          <Input value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onBlur={onRenameCommit} onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }} className="h-5 text-[10px] font-bold uppercase tracking-wider flex-1 py-0 px-1" autoFocus onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase flex-1">{node.group.name}</span>
        )}
        <button className="shrink-0 p-0.5 rounded-md opacity-0 group-hover/cat:opacity-100 text-muted-foreground hover:text-foreground cursor-pointer transition-opacity" onClick={(e) => onGroupMenu(e, node.group.id)}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <span className="bg-overlay/[0.06] text-muted-foreground text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium">{total}</span>
      </div>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <DraggableGroup key={child.group.id} id={child.group.id}>
              <GroupTreeNode {...props} node={child} level={level + 1} />
            </DraggableGroup>
          ))}

          {/* 新建子分组的 inline input — 放在子分组后面、测试集前面 */}
          {inlineInput && inlineInput.parentGroupId === node.group.id && inlineInput.type === 'group' && (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} className="pr-2 py-1">
              <Input value={inlineValue} onChange={(e) => onInlineChange(e.target.value)} onBlur={onInlineCommit} onKeyDown={(e) => { if (e.key === 'Enter') onInlineCommit(); if (e.key === 'Escape') onInlineCancel() }} placeholder={t('common.subgroup_name_placeholder')} className="h-5 text-xs py-0 px-1" autoFocus />
            </div>
          )}

          <SortableContext items={collectionIds} strategy={verticalListSortingStrategy}>
            {node.collections.map((col) => {
              const isSelected = selectedNodeId === col.id
              const isColRenaming = renamingId === col.id
              return (
                <SortableCollectionRow key={col.id} id={col.id} groupId={node.group.id} overId={overId}>
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

          {/* 新建测试集的 inline input — 放在测试集末尾 */}
          {inlineInput && inlineInput.parentGroupId === node.group.id && inlineInput.type === 'suite' && (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }} className="pr-2 py-1">
              <Input value={inlineValue} onChange={(e) => onInlineChange(e.target.value)} onBlur={onInlineCommit} onKeyDown={(e) => { if (e.key === 'Enter') onInlineCommit(); if (e.key === 'Escape') onInlineCancel() }} placeholder={t('common.suite_name_placeholder')} className="h-5 text-xs py-0 px-1" autoFocus />
            </div>
          )}
        </>
      )}
    </div>
  )
}
