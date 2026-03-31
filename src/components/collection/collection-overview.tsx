import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  Play, Download, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Link2, Square, Zap, ListOrdered, GripVertical, Pencil, Copy,
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
  const { loadTree, loadCollections, selectedNodeId, selectNode } = useCollectionStore()
  const { envVars } = useEnvVars()

  const tableItems = useMemo(() => flattenTreeToTableItems(tree), [tree])
  const allRequests = useMemo(() => allRequestsFromTableItems(tableItems), [tableItems])

  const runner = useCollectionRunner({ collectionId: collection.id, allRequests })
  const {
    statuses, running, runningIds, progress, singleResults, batchResult,
    error, streamingContents,
    runMode, setRunMode, concurrency, setConcurrency, delayMs, setDelayMs,
    total, passed, failed, passRate, progressPercent,
    runAll, stopRun, runSingle, runChain,
    getStatus, getResult, loadStatuses, resetResults, clearItemResult, cleanup,
  } = runner

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [detailData, setDetailData] = useState<Record<string, CollectionItem>>({})
  const [itemVersion, setItemVersion] = useState<Record<string, number>>({})
  const [editReq, setEditReq] = useState<CollectionItem | null>(null)
  const editReqSnapshot = useRef<string>('')
  const [isNewReq, setIsNewReq] = useState(false)
  const [showRunSettings, setShowRunSettings] = useState(false)
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

    try {
      await invoke('reorder_items', { items: orders })
      await loadTree(collection.id)
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }, [tableItems, sortableIds, collection.id, loadTree])

  useEffect(() => { return () => { cleanup() } }, [])
  useEffect(() => { loadStatuses(); resetResults(); setDetailData({}) }, [collection.id])
  // tree 变化时（增删 case）重新加载状态，保持统计卡片同步
  useEffect(() => { loadStatuses() }, [tree])

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
      try {
        await invoke('update_item', { id: editingChainId, payload: { name: trimmed } })
        await loadTree(collection.id)
      } catch (e) { toast.error(invokeErrorMessage(e)) }
    }
    setEditingChainId(null)
  }

  const addChain = () => { setChainName(''); setChainDesc(''); setShowChainDialog(true) }
  const saveChain = async () => {
    if (!chainName.trim() || savingChain) return
    setSavingChain(true)
    try {
      await invoke('create_item', { collectionId: collection.id, parentId: null, itemType: 'chain', name: chainName.trim(), method: 'GET' })
      await loadTree(collection.id)
      setShowChainDialog(false)
      resetResults()
    } catch (e) { toast.error(invokeErrorMessage(e)) }
    finally { setSavingChain(false) }
  }

  const addChainStep = async (chainId: string) => {
    setExpandedRows((prev) => {
      const n = new Set(prev)
      n.add(`group-${chainId}`)
      return n
    })
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
    await invoke('delete_item', { id })
    await loadTree(collection.id)
    setDetailData((prev) => { const n = { ...prev }; delete n[id]; return n })
    if (selectedNodeId === id) selectNode(null)
    resetResults()
  }

  const copyRequest = useCallback(async (id: string) => {
    try {
      await invoke('duplicate_item', { id })
      await loadTree(collection.id)
      resetResults()
    } catch (e) { toast.error(invokeErrorMessage(e)) }
  }, [collection.id, loadTree, resetResults])

  const deleteRequest = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm(t('common.confirm_delete', { name }), { title: t('common.delete'), kind: 'warning' })
    if (!ok) return
    await invoke('delete_item', { id })
    await loadTree(collection.id)
    setExpandedRows((prev) => { const n = new Set(prev); n.delete(id); return n })
    setDetailData((prev) => { const n = { ...prev }; delete n[id]; return n })
    if (selectedNodeId === id) selectNode(null)
    resetResults()
  }

  const openEdit = useCallback(async (id: string) => {
    try {
      const req = await invoke<CollectionItem>('get_item', { id })
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

  const saveEdit = async () => {
    if (!editReq || saving) return
    if (!editReq.name.trim()) { return }
    setSaving(true)
    try {
      if (isNewReq) {
        const created = await invoke<CollectionItem>('create_item', {
          collectionId: collection.id,
          parentId: editReq.parent_id,
          itemType: editReq.type,
          name: editReq.name,
          method: editReq.method,
        })
        await invoke('update_item', {
          id: created.id,
          payload: {
            url: editReq.url,
            headers: editReq.headers,
            queryParams: editReq.query_params,
            bodyType: editReq.body_type,
            bodyContent: editReq.body_content,
            extractRules: editReq.extract_rules,
            description: editReq.description,
            expectStatus: editReq.expect_status,
          },
        })
      } else {
        const payload = {
          name: editReq.name,
          method: editReq.method,
          url: editReq.url,
          headers: editReq.headers,
          queryParams: editReq.query_params,
          bodyType: editReq.body_type,
          bodyContent: editReq.body_content,
          extractRules: editReq.extract_rules,
          description: editReq.description,
          expectStatus: editReq.expect_status,
        }
        console.log('[QAI] saveEdit payload:', payload)
        await invoke('update_item', { id: editReq.id, payload })
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
          placeholder="双击添加描述..."
          onSave={async (v) => {
            await invoke('update_collection', { id: collection.id, description: v })
            await loadCollections()
          }}
        />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="TOTAL" value={total} />
        <StatCard label="PASSED" value={passed} color="text-emerald-500" />
        <StatCard label="FAILED" value={failed} color="text-red-500" />
        <div className="rounded-xl border border-overlay/[0.06] px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PASS RATE</span>
          <div className="text-xl font-bold tabular-nums mt-0.5" style={{ color: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : passed + failed === 0 ? 'inherit' : '#ef4444' }}>
            {passed + failed > 0 ? `${passRate}%` : '-'}
          </div>
          {passed + failed > 0 && <div className="mt-1.5 h-1.5 rounded-full bg-overlay/[0.06] overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${passRate}%`, background: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444' }} /></div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
        {running ? (
          <Button onClick={stopRun} size="sm" variant="destructive" className="gap-1.5">
            <Square className="h-3 w-3" /> {t('dashboard.stop')}
          </Button>
        ) : (
          <div className="relative flex items-center">
            <Button onClick={handleRunAll} size="sm" className="gap-1.5 pr-0">
              <Play className="h-3.5 w-3.5" /> {t('dashboard.run_all')}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setShowRunSettings(!showRunSettings) }}
                className="ml-1 pl-1.5 pr-2 h-full flex items-center border-l border-primary-foreground/20 hover:bg-primary-foreground/10 rounded-r-lg transition-colors"
                title={runMode === 'concurrent' ? `${t('dashboard.concurrent')} ×${concurrency}` : `${t('dashboard.sequential')}${delayMs ? ` ${delayMs / 1000}s` : ''}`}
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${showRunSettings ? 'rotate-180' : ''}`} />
              </span>
            </Button>
            <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
              {runMode === 'concurrent' ? <><Zap className="h-3 w-3 inline -mt-px" /> ×{concurrency}</> : <><ListOrdered className="h-3 w-3 inline -mt-px" />{delayMs ? ` ${delayMs / 1000}s` : ''}</>}
            </span>
            {showRunSettings && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRunSettings(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-xl glass-card p-1.5 shadow-2xl space-y-0.5">
                  <button type="button" onClick={() => setRunMode('concurrent')} className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${runMode === 'concurrent' ? 'bg-overlay/[0.08] text-foreground' : 'text-muted-foreground hover:bg-overlay/[0.04]'}`}>
                    <Zap className="h-3.5 w-3.5" /> {t('dashboard.concurrent')}
                  </button>
                  {runMode === 'concurrent' && (
                    <div className="px-2.5 py-2 space-y-1.5">
                      <div className="flex gap-1">
                        {[1, 3, 5, 10, 20].map((n) => (
                          <button key={n} type="button" onClick={() => setConcurrency(n)} className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-colors ${concurrency === n ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-overlay/[0.04]'}`}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="h-px bg-overlay/[0.06]" />
                  <button type="button" onClick={() => setRunMode('sequential')} className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${runMode === 'sequential' ? 'bg-overlay/[0.08] text-foreground' : 'text-muted-foreground hover:bg-overlay/[0.04]'}`}>
                    <ListOrdered className="h-3.5 w-3.5" /> {t('dashboard.sequential')}
                  </button>
                  {runMode === 'sequential' && (
                    <div className="px-2.5 py-2 space-y-1.5">
                      <div className="flex gap-1 flex-wrap">
                        {[0, 1000, 2000, 3000, 5000, 10000].map((ms) => (
                          <button key={ms} type="button" onClick={() => setDelayMs(ms)} className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-colors ${delayMs === ms ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-overlay/[0.04]'}`}>
                            {ms === 0 ? t('common.none') : `${ms / 1000}s`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
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
              const groupColor = isAnyStepRunning ? 'text-blue-500' : groupStatuses.length === 0 ? '' : groupPass ? 'text-emerald-500' : groupFail ? 'text-red-500' : ''
              return (
                <SortableRow key={item.groupId} id={item.groupId}>
                  {(dragHandleProps) => (
                <div>
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_80px_64px_64px_80px_72px] gap-2 px-4 py-2.5 text-sm bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer transition-colors group"
                    onClick={() => setExpandedRows((p) => { const n = new Set(p); n.has(groupKey) ? n.delete(groupKey) : n.add(groupKey); return n })}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span {...dragHandleProps} className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity shrink-0 touch-none" onClick={(e) => e.stopPropagation()}>
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <input
                        type="checkbox"
                        checked={!disabledIds.has(item.groupId)}
                        onChange={() => setDisabledIds((prev) => { const n = new Set(prev); n.has(item.groupId) ? n.delete(item.groupId) : n.add(item.groupId); return n })}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0 mr-1"
                      />
                      {groupExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-amber-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-amber-500" />}
                      <Link2 className="h-3 w-3 shrink-0 text-amber-500" />
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
                          <span className="font-medium truncate text-amber-500/90" onDoubleClick={(e) => startEditChain(item.groupId, item.groupName, e)}>{item.groupName}</span>
                          <span className="text-[10px] text-amber-500/50 ml-1">{item.steps.length} {t('scenario.steps')}</span>
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
                          {isChainRunning ? <Loader2 className="h-3 w-3 animate-spin text-amber-500" /> : <Play className="h-3 w-3 text-amber-500" />}
                        </button>
                      ) })()}
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={(e) => startEditChain(item.groupId, item.groupName, e)} title={t('tree.rename')}>
                        <Pencil className="h-3 w-3 text-amber-500" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => addChainStep(item.groupId)} title={t('chain.add_step')}>
                        <Plus className="h-3 w-3 text-amber-500" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => copyRequest(item.groupId)} title={t('common.copy')}>
                        <Copy className="h-3 w-3 text-amber-500" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => deleteChain(item.groupId, item.groupName, e)} title={t('common.delete')}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </span>
                  </div>
                  {groupExpanded && item.steps.map((r, stepIdx) => {
                    const prevDone = stepIdx === 0 || !!getStatus(item.steps[stepIdx - 1].id)
                    return <ScenarioRow key={r.id} r={r} stepLabel={`Step ${stepIdx + 1}`} version={itemVersion[r.id]} indent envVars={envVars} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} loadDetail={loadDetail} toggleRow={toggleRow} runSingle={handleRunSingle} openEdit={openEdit} copyRequest={copyRequest} deleteRequest={deleteRequest} streamingContent={streamingContents[r.id]} canRun={prevDone} />
                  })}
                </div>
                  )}
                </SortableRow>
              )
            }
            return (
              <SortableRow key={item.id} id={item.id}>
                {(dragHandleProps) => (
                  <ScenarioRow r={item} version={itemVersion[item.id]} envVars={envVars} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} loadDetail={loadDetail} toggleRow={toggleRow} runSingle={handleRunSingle} openEdit={openEdit} copyRequest={copyRequest} deleteRequest={deleteRequest} streamingContent={streamingContents[item.id]} enabled={!disabledIds.has(item.id)} onToggleEnabled={(id) => setDisabledIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} dragHandleProps={dragHandleProps} />
                )}
              </SortableRow>
            )
          })}
        </div>
        </SortableContext>
        </DndContext>
      </div>

      <Dialog open={!!editReq} onOpenChange={async (open) => { if (!open) await closeEditDialog() }}>
        <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
          <DialogClose onClose={closeEditDialog} />
          <DialogHeader><DialogTitle>{isNewReq ? t('edit.new_case') : t('edit.edit_case')}</DialogTitle></DialogHeader>
          {editReq && (
            <EditForm
              key={editReq.id}
              req={editReq}
              onChange={setEditReq}
              onSave={saveEdit}
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
              <label className="text-xs text-muted-foreground mb-1 block">链名称</label>
              <Input value={chainName} onChange={(e) => setChainName(e.target.value)} className="h-8 text-sm" placeholder="如：自定义音色 TTS" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveChain()} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">描述</label>
              <Input value={chainDesc} onChange={(e) => setChainDesc(e.target.value)} className="h-8 text-sm" placeholder="多步依赖：上传→生成" />
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
