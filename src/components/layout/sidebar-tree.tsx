import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MoreHorizontal, Circle } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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

// ─── 可排序行 ──────────────────
export function SortableGroupRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'group' } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>
}

export function SortableCollectionRow({ id, groupId, children }: { id: string; groupId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'collection', groupId } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>
}

// ─── 递归分组树节点 ─────────────
export interface GroupTreeNodeProps {
  node: GroupNode; level: number; expanded: Set<string>; selectedNodeId: string | null
  renamingId: string | null; renameValue: string
  inlineInput: { parentGroupId: string; type: 'group' | 'suite' } | null; inlineValue: string
  onToggle: (id: string) => void; onSelect: (col: Collection) => void
  onGroupMenu: (e: React.MouseEvent, groupId: string) => void; onColMenu: (e: React.MouseEvent, col: Collection) => void
  onRenameChange: (v: string) => void; onRenameCommit: () => void; onRenameCancel: () => void
  onInlineChange: (v: string) => void; onInlineCommit: () => void; onInlineCancel: () => void
}

export function GroupTreeNode(props: GroupTreeNodeProps) {
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
