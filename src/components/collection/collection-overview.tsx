import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  Play, Download, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Link2, Square, GripVertical, Pencil, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { useCollectionStore } from '@/stores/collection-store'
import { useRunConfigStore } from '@/stores/run-queue-store'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { useEnvVars } from '@/hooks/use-env-vars'
import { useCollectionRunner } from '@/hooks/use-collection-runner'
import type { Collection, CollectionTreeNode, CollectionItem } from '@/types'
import {
  flattenTreeToTableItems,
  allRequestsFromTableItems,
  type TableItem,
} from './collection-overview-model'
import { StatCard, InlineEdit, EditForm } from './collection-overview-edit-parts'
import { ScenarioRow } from './collection-overview-scenario-row'

function getTableItemId(item: TableItem): string {
  return 'isChain' in item ? item.groupId : item.id
}

/** 可排序行包装器 —— 给子元素注入 drag handle 的 listeners */
function SortableRow({ id, children }: { id: string; children: (dragHandleProps: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners ?? {})}
    </div>
  )
}

interface Props {
  collection: Collection
  tree: CollectionTreeNode | undefined
}

export default function CollectionOverview({ collection, tree }: Props) {
  const { t } = useTranslation()
  const confirm = useConfirmStore((s) => s.confirm)
  const { loadTree, loadCollections, selectedNodeId, selectNode, updateItem, deleteItem, duplicateItem, reorderItems, createItem: storeCreateItem } = useCollectionStore()
  const { envVars } = useEnvVars()

  const tableItems = useMemo(() => flattenTreeToTableItems(tree), [tree])
  const allRequests = useMemo(() => allRequestsFromTableItems(tableItems), [tableItems])

  const runner = useCollectionRunner({ collectionId: collection.id, allRequests, tableItems })
  const {
    statuses, running, runningIds, progress, singleResults, batchResult,
    error, streamingContents,
    total, passed, failed, passRate, progressPercent,
    runAll, stopRun, runSingle, runChain,
    getStatus, getResult, loadStatuses, resetResults, clearItemResult, cleanup,
  } = runner
  const dryRun = useRunConfigStore((s) => s.dryRun)

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [detailData, setDetailData] = useState<Record<string, CollectionItem>>({})
  const [itemVersion, setItemVersion] = useState<Record<string, number>>({})
  const [assertionCounts, setAssertionCounts] = useState<Record<string, number>>({})
  const [editReq, setEditReq] = useState<CollectionItem | null>(null)
  const editReqSnapshot = useRef<string>('')
  const editDialogKey = useRef(0)
  const [isNewReq, setIsNewReq] = useState(false)
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savingChain, setSavingChain] = useState(false)
  const [editingChainId, setEditingChainId] = useState<string | null>(null)
  const [editingChainName, setEditingChainName] = useState('')

  // ── 拖拽排序 ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const sortableIds = useMemo(() => tableItems.map(getTableItemId), [tableItems])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sortableIds.indexOf(active.id as string)
    const newIdx = sortableIds.indexOf(over.id as string)
    if (oldIdx === -1 || newIdx === -1) return

    // 计算新顺序
    const reordered = [...tableItems]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)

    // 构建 sort_order 更新列表
    const orders = reordered.map((item, i) => ({
      id: getTableItemId(item),
      sort_order: i,
    }))

    await reorderItems(orders)
    await loadTree(collection.id)
  }, [tableItems, sortableIds, collection.id, loadTree])

  const loadAssertionCounts = useCallback(async () => {
    try {
      const counts = await invoke<Record<string, number>>('get_assertion_counts', { collectionId: collection.id })
      setAssertionCounts(counts)
    } catch { /* ignore */ }
  }, [collection.id])

  useEffect(() => { return () => { cleanup() } }, [])
  useEffect(() => { cleanup(); loadStatuses(); resetResults(); setDetailData({}); loadAssertionCounts() }, [collection.id])
  // tree 变化时（增删 case）重新加载状态，保持统计卡片同步
  useEffect(() => { loadStatuses(); loadAssertionCounts() }, [tree])

  // MCP 写操作后自动刷新
  useEffect(() => {
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('mcp:data-changed', () => {
        loadTree(collection.id)
        loadCollections()
        loadAssertionCounts()
      }).then((fn) => { unlisten = fn })
    })
    return () => { unlisten?.() }
  }, [collection.id, loadTree, loadCollections])

  useEffect(() => {
    const handler = () => addTestCase()
    window.addEventListener('qai:new-request', handler)
    return () => window.removeEventListener('qai:new-request', handler)
  })

  const handleRunSingle = async (requestId: string) => {
    setExpandedRows((prev) => new Set(prev).add(requestId))
    await runSingle(requestId)
  }

  const handleRunAll = async () => {
    // 展开 chain groupId 为其下所有 step ids
    const expandedDisabled = new Set(disabledIds)
    for (const item of tableItems) {
      if ('isChain' in item && disabledIds.has(item.groupId)) {
        for (const step of item.steps) expandedDisabled.add(step.id)
      }
    }
    await runAll(expandedDisabled)
  }

  const addTestCase = () => {
    editDialogKey.current += 1
    setIsNewReq(true)

    const initial: CollectionItem = {
      id: '',
      collection_id: collection.id,
      parent_id: null,
      type: 'request',
      name: '',
      sort_order: 0,
      method: 'POST',
      url: '',
      headers: '[]',
      query_params: '[]',
      body_type: 'none',
      body_content: '',
      extract_rules: '[]',
      description: '',
      expect_status: 200,
      poll_config: '',
      protocol: 'http',
      created_at: '',
      updated_at: '',
    }
    setEditReq(initial)
    editReqSnapshot.current = JSON.stringify(initial)
  }

  const [showChainDialog, setShowChainDialog] = useState(false)
  const [chainName, setChainName] = useState('')
  const [chainDesc, setChainDesc] = useState('')
  const startEditChain = (chainId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingChainId(chainId)
    setEditingChainName(currentName)
  }
  const commitChainRename = async () => {
    if (!editingChainId) return
    const trimmed = editingChainName.trim()
    if (trimmed) {
      await updateItem(editingChainId, collection.id, { name: trimmed })
    }
    setEditingChainId(null)
  }

  const addChain = () => { setChainName(''); setChainDesc(''); setShowChainDialog(true) }
  const saveChain = async () => {
    if (!chainName.trim() || savingChain) return
    setSavingChain(true)
    try {
      await storeCreateItem(collection.id, null, chainName.trim(), 'GET', 'chain')
      setShowChainDialog(false)
      resetResults()
    } catch { /* store 内部已处理 */ }
    finally { setSavingChain(false) }
  }

  const addChainStep = async (chainId: string) => {
    setExpandedRows((prev) => {
      const n = new Set(prev)
      n.add(`group-${chainId}`)
      return n
    })
    editDialogKey.current += 1
    setIsNewReq(true)

    const initial = {
      id: '',
      collection_id: collection.id,
      parent_id: chainId,
      type: 'request',
      name: t('common.new_step'),
      sort_order: 0,
      method: 'POST',
      url: '',
      headers: '[]',
      query_params: '[]',
      body_type: 'none',
      body_content: '',
      extract_rules: '[]',
      description: '',
      expect_status: 200,
      poll_config: '',
      protocol: 'http',
      created_at: '',
      updated_at: '',
    } as CollectionItem
    setEditReq(initial)
    editReqSnapshot.current = JSON.stringify(initial)
  }

  const deleteChain = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm(t('common.confirm_delete', { name }), { title: t('common.delete'), kind: 'warning' })
    if (!ok) return
    await deleteItem(id, collection.id)
    setDetailData((prev) => { const n = { ...prev }; delete n[id]; return n })
    if (selectedNodeId === id) selectNode(null)
    resetResults()
  }

  const copyRequest = useCallback(async (id: string) => {
    await duplicateItem(id, collection.id)
    resetResults()
  }, [collection.id, duplicateItem, resetResults])

  const deleteRequest = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm(t('common.confirm_delete', { name }), { title: t('common.delete'), kind: 'warning' })
    if (!ok) return
    await deleteItem(id, collection.id)
    setExpandedRows((prev) => { const n = new Set(prev); n.delete(id); return n })
    setDetailData((prev) => { const n = { ...prev }; delete n[id]; return n })
    if (selectedNodeId === id) selectNode(null)
    resetResults()
  }

  const openEdit = useCallback(async (id: string) => {
    try {
      const req = await invoke<CollectionItem>('get_item', { id })
      editDialogKey.current += 1
      setIsNewReq(false)
      setEditReq(req)
      editReqSnapshot.current = JSON.stringify(req)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('qai.openEditDebug')
      if (!raw) return
      const parsed = JSON.parse(raw) as { itemId: string; collectionId: string }
      if (parsed.collectionId !== collection.id) return
      sessionStorage.removeItem('qai.openEditDebug')
      void openEdit(parsed.itemId)
    } catch { /* ignore */ }
  }, [collection.id, openEdit])

  const closeEditDialog = async () => {
    if (editReq) {
      const current = JSON.stringify(editReq)
      const hasChanges = current !== editReqSnapshot.current
      if (hasChanges) {
        const ok = await confirm(t('common.confirm_discard'), { title: t('common.close_confirm'), kind: 'warning' })
        if (!ok) return
      }
    }
    setEditReq(null)

    setIsNewReq(false)
  }

  /** 构建 update_item payload（ensureSaved / saveEdit 共用）
   * 注意：不包含 expectStatus，它由断言编辑器通过 update_assertion 反向同步到 item */
  const buildPayload = (r: CollectionItem) => ({
    name: r.name,
    method: r.method,
    url: r.url,
    headers: r.headers,
    queryParams: r.query_params,
    bodyType: r.body_type,
    bodyContent: r.body_content,
    extractRules: r.extract_rules,
    description: r.description,
  })

  /** 创建新 item 并返回 ID（ensureSaved / saveEdit 共用） */
  const createNewItem = async (r: CollectionItem): Promise<string> => {
    const created = await invoke<CollectionItem>('create_item', {
      collectionId: collection.id,
      parentId: r.parent_id,
      itemType: r.type,
      name: r.name,
      method: r.method,
    })
    await invoke('update_item', { id: created.id, payload: buildPayload(r) })
    return created.id
  }

  // 新建时自动保存（获取 ID 后断言 Tab 可用），不关闭弹窗
  const ensureSaved = async (): Promise<string | null> => {
    if (!editReq || !editReq.name.trim()) return null
    if (editReq.id) return editReq.id
    try {
      const id = await createNewItem(editReq)
      setEditReq({ ...editReq, id })
      editReqSnapshot.current = JSON.stringify({ ...editReq, id })
      setIsNewReq(false)
      await loadTree(collection.id)
      return id
    } catch (e) {
      toast.error(invokeErrorMessage(e))
      return null
    }
  }

  const saveEdit = async () => {
    if (!editReq || saving) return
    if (!editReq.name.trim()) { return }
    setSaving(true)
    try {
      if (isNewReq) {
        await createNewItem(editReq)
      } else {
        await invoke('update_item', { id: editReq.id, payload: buildPayload(editReq) })
      }
      await loadTree(collection.id)

      if (editReq) {
        setDetailData((prev) => { const n = { ...prev }; delete n[editReq.id]; return n })
        if (!isNewReq) {
          clearItemResult(editReq.id)
          setItemVersion((prev) => ({ ...prev, [editReq.id]: (prev[editReq.id] ?? 0) + 1 }))
        }
      }
      if (isNewReq) { resetResults() }
      toast.success(t('settings.saved'))
      await new Promise((r) => setTimeout(r, 600))
      setSaving(false)
      setEditReq(null)
      setIsNewReq(false)
    } catch (e: unknown) {
      toast.error(invokeErrorMessage(e) || t('common.save_failed'))
      setSaving(false)
    }
  }

  const loadDetail = async (id: string) => {
    if (detailData[id]) return
    try {
      const req = await invoke<CollectionItem>('get_item', { id })
      setDetailData((prev) => ({ ...prev, [id]: req }))
    } catch { /* ignore */ }
  }

  const toggleRow = async (id: string) => {
    const next = new Set(expandedRows)
    if (next.has(id)) { next.delete(id) } else {
      next.add(id)
      loadDetail(id)
    }
    setExpandedRows(next)
  }

  const exportHtml = async () => {
    if (!batchResult) return
    const html = await invoke<string>('export_report_html', { batchResult })
    const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report-${collection.name}-${new Date().toISOString().slice(0, 10)}.html`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="px-6 py-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold mb-1.5">{collection.name}</h1>
        <InlineEdit
          value={collection.description}
          placeholder={t('edit.double_click_add_desc')}
          onSave={async (v) => {
            try {
              await invoke('update_collection', { id: collection.id, description: v })
              await loadCollections()
            } catch (e) { toast.error(invokeErrorMessage(e)) }
          }}
        />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="TOTAL" value={total} />
        <StatCard label="PASSED" value={passed} color="text-success" />
        <StatCard label="FAILED" value={failed} color="text-error" />
        <div className="rounded-xl border border-overlay/[0.06] px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PASS RATE</span>
          <div className="text-xl font-bold tabular-nums mt-0.5 text-success" style={{ color: passRate === 100 ? 'var(--color-success)' : passRate >= 60 ? 'var(--color-warning)' : passed + failed === 0 ? 'inherit' : 'var(--color-error)' }}>
            {passed + failed > 0 ? `${passRate}%` : '-'}
          </div>
          {passed + failed > 0 && <div className="mt-1.5 h-1.5 rounded-full bg-overlay/[0.06] overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${passRate}%`, background: passRate === 100 ? 'var(--color-success)' : passRate >= 60 ? 'var(--color-warning)' : 'var(--color-error)' }} /></div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
        {running ? (
          <Button onClick={stopRun} size="sm" variant="destructive" className="gap-1.5">
            <Square className="h-3 w-3" /> {t('dashboard.stop')}
          </Button>
        ) : (
          <Button onClick={handleRunAll} size="sm" className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> {dryRun ? t('dashboard.dry_run') : t('dashboard.run_all')}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addTestCase}>
          <Plus className="h-3.5 w-3.5" /> {t('dashboard.add_case')}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addChain}>
          <Link2 className="h-3.5 w-3.5" /> {t('dashboard.add_chain')}
        </Button>
        {batchResult && <Button variant="outline" size="sm" onClick={exportHtml} className="gap-1.5"><Download className="h-3.5 w-3.5" /> {t('dashboard.export_report')}</Button>}
        </div>
      </div>

      {running && (() => {
        const done = progress.filter((p) => p.status !== 'running').length || Object.keys(singleResults).length
        const totalCount = progress[0]?.total ?? total
        const currentItem = progress.find((p) => p.status === 'running')
        const currentName = currentItem ? allRequests.find((r) => r.id === currentItem.item_id)?.name : undefined
        return (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{currentName ? currentName : t('dashboard.run_all')} ({done}/{totalCount})</span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} />
          </div>
        )
      })()}
      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>}

      <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
        <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_64px_64px_80px_72px] gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-overlay/[0.04]">
          <span className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={disabledIds.size === 0}
              ref={(el) => { if (el) el.indeterminate = disabledIds.size > 0 && disabledIds.size < tableItems.filter((t) => !('isChain' in t)).length + tableItems.filter((t) => 'isChain' in t).length }}
              onChange={() => {
                if (disabledIds.size === 0) {
                  const allIds = new Set(tableItems.map((t) => 'isChain' in t ? t.groupId : t.id))
                  setDisabledIds(allIds)
                } else {
                  setDisabledIds(new Set())
                }
              }}
              className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0"
            />
            {t('scenario.scenario')}
          </span><span>{t('scenario.status')}</span><span>{t('scenario.http')}</span><span>{t('scenario.total_time')}</span><span>{t('scenario.last_run')}</span><span />
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="overflow-y-auto divide-y divide-overlay/[0.04]" style={{ maxHeight: 'calc(100vh - 380px)' }}>
          {tableItems.length === 0 ? (
            <EmptyState title={t('dashboard.no_cases')} className="py-12" />
          ) : tableItems.map((item) => {
            if ('isChain' in item) {
              const groupKey = `group-${item.groupId}`
              const groupExpanded = expandedRows.has(groupKey)
              const isAnyStepRunning = runningIds.has(item.groupId) || item.steps.some((s) => runningIds.has(s.id) || progress.find((p) => p.item_id === s.id)?.status === 'running')
              const groupStatuses = item.steps.map((s) => getStatus(s.id)).filter(Boolean)
              const groupPass = groupStatuses.every((s) => s === 'success')
              const groupFail = groupStatuses.some((s) => s === 'failed' || s === 'error')
              const groupLabel = isAnyStepRunning ? 'Running' : groupStatuses.length === 0 ? '-' : groupPass ? 'PASS' : groupFail ? 'FAIL' : '-'
              const groupColor = isAnyStepRunning ? 'text-info' : groupStatuses.length === 0 ? '' : groupPass ? 'text-success' : groupFail ? 'text-error' : ''
              return (
                <SortableRow key={item.groupId} id={item.groupId}>
                  {(dragHandleProps) => (
                <div>
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_80px_64px_64px_80px_72px] gap-2 px-4 py-2.5 text-sm bg-warning/5 hover:bg-warning/10 cursor-pointer transition-colors group"
                    onClick={() => {
                      setExpandedRows((p) => {
                        const n = new Set(p)
                        if (n.has(groupKey)) n.delete(groupKey)
                        else n.add(groupKey)
                        return n
                      })
                    }}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span {...dragHandleProps} className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity shrink-0 touch-none" onClick={(e) => e.stopPropagation()}>
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <input
                        type="checkbox"
                        checked={!disabledIds.has(item.groupId)}
                        onChange={() => {
                          setDisabledIds((prev) => {
                            const n = new Set(prev)
                            if (n.has(item.groupId)) n.delete(item.groupId)
                            else n.add(item.groupId)
                            return n
                          })
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0 mr-1"
                      />
                      {groupExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-warning" /> : <ChevronRight className="h-3 w-3 shrink-0 text-warning" />}
                      <Link2 className="h-3 w-3 shrink-0 text-warning" />
                      {editingChainId === item.groupId ? (
                        <Input
                          value={editingChainName}
                          onChange={(e) => setEditingChainName(e.target.value)}
                          onBlur={commitChainRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitChainRename(); if (e.key === 'Escape') setEditingChainId(null) }}
                          className="h-6 text-sm font-medium w-48"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <span className="font-medium truncate text-warning/90" onDoubleClick={(e) => startEditChain(item.groupId, item.groupName, e)}>{item.groupName}</span>
                          <span className="text-[10px] text-warning/50 ml-1">{item.steps.length} {t('scenario.steps')}</span>
                        </>
                      )}
                    </span>
                    <span className={`flex items-center gap-1 font-bold text-xs ${groupColor}`}>{groupLabel}</span>
                    <span className="font-mono text-xs self-center">-</span>
                    <span />
                    <span />
                    <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {(() => { const isChainRunning = runningIds.has(item.groupId); return (
                        <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => runChain(item.groupId, item.steps.map((s) => s.id))} disabled={isChainRunning} title={t('runner.run_chain')}>
                          {isChainRunning ? <Loader2 className="h-3 w-3 animate-spin text-warning" /> : <Play className="h-3 w-3 text-warning" />}
                        </button>
                      ) })()}
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={(e) => startEditChain(item.groupId, item.groupName, e)} title={t('tree.rename')}>
                        <Pencil className="h-3 w-3 text-warning" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => addChainStep(item.groupId)} title={t('chain.add_step')}>
                        <Plus className="h-3 w-3 text-warning" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => copyRequest(item.groupId)} title={t('common.copy')}>
                        <Copy className="h-3 w-3 text-warning" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => deleteChain(item.groupId, item.groupName, e)} title={t('common.delete')}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </span>
                  </div>
                  {groupExpanded && item.steps.map((r, stepIdx) => {
                    const prevDone = stepIdx === 0 || !!getStatus(item.steps[stepIdx - 1].id)
                    return <ScenarioRow key={r.id} r={r} stepLabel={`Step ${stepIdx + 1}`} version={itemVersion[r.id]} indent envVars={envVars} assertionCount={assertionCounts[r.id] ?? 0} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} loadDetail={loadDetail} toggleRow={toggleRow} runSingle={handleRunSingle} openEdit={openEdit} copyRequest={copyRequest} deleteRequest={deleteRequest} streamingContent={streamingContents[r.id]} canRun={prevDone} />
                  })}
                </div>
                  )}
                </SortableRow>
              )
            }
            return (
              <SortableRow key={item.id} id={item.id}>
                {(dragHandleProps) => (
                  <ScenarioRow r={item} version={itemVersion[item.id]} envVars={envVars} assertionCount={assertionCounts[item.id] ?? 0} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} loadDetail={loadDetail} toggleRow={toggleRow} runSingle={handleRunSingle} openEdit={openEdit} copyRequest={copyRequest} deleteRequest={deleteRequest} streamingContent={streamingContents[item.id]} enabled={!disabledIds.has(item.id)} onToggleEnabled={(id) => {
                    setDisabledIds((prev) => {
                      const n = new Set(prev)
                      if (n.has(id)) n.delete(id)
                      else n.add(id)
                      return n
                    })
                  }} dragHandleProps={dragHandleProps} />
                )}
              </SortableRow>
            )
          })}
        </div>
        </SortableContext>
        </DndContext>
        </div>
        </div>
      </div>

      <Dialog open={!!editReq} onOpenChange={async (open) => { if (!open) await closeEditDialog() }}>
        <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
          <DialogClose onClose={closeEditDialog} />
          <DialogHeader><DialogTitle>{isNewReq ? t('edit.new_case') : t('edit.edit_case')}</DialogTitle></DialogHeader>
          {editReq && (
            <EditForm
              key={editDialogKey.current}
              req={editReq}
              onChange={setEditReq}
              onSave={saveEdit}
              onEnsureSaved={ensureSaved}
              onCancel={closeEditDialog}
              envVars={envVars}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showChainDialog} onOpenChange={setShowChainDialog}>
        <DialogContent className="max-w-sm">
          <DialogClose onClose={() => setShowChainDialog(false)} />
          <DialogHeader><DialogTitle>{t('edit.new_chain')}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('edit.chain_name_label')}</label>
              <Input value={chainName} onChange={(e) => setChainName(e.target.value)} className="h-8 text-sm" placeholder={t('edit.chain_name_placeholder')} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveChain()} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('edit.desc')}</label>
              <Input value={chainDesc} onChange={(e) => setChainDesc(e.target.value)} className="h-8 text-sm" placeholder={t('edit.chain_desc_placeholder')} />
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
              {t('chain.chain_help')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowChainDialog(false)}>{t('edit.cancel')}</Button>
              <Button size="sm" onClick={saveChain} disabled={!chainName.trim()}>{t('edit.create')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
