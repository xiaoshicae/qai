import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Play, Download, CheckCircle2, XCircle, AlertCircle, Circle,
  ChevronDown, ChevronRight, Loader2, Plus, Trash2, Pencil, Link2, Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import KeyValueTable from '@/components/request/key-value-table'
import { Progress } from '@/components/ui/progress'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { useCollectionStore } from '@/stores/collection-store'
import type {
  Collection, CollectionTreeNode, ItemLastStatus,
  BatchResult, TestProgress, ExecutionResult, CollectionItem,
} from '@/types'

const BODY_TYPES = [
  { id: 'none', label: 'None' },
  { id: 'form-data', label: 'Form Data' },
  { id: 'urlencoded', label: 'URL Encoded' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw' },
]

interface Props {
  collection: Collection
  tree: CollectionTreeNode | undefined
}

export default function CollectionOverview({ collection, tree }: Props) {
  const confirm = useConfirmStore((s) => s.confirm)
  const { loadTree } = useCollectionStore()
  const [statuses, setStatuses] = useState<Record<string, ItemLastStatus>>({})
  const [running, setRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<TestProgress[]>([])
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [singleResults, setSingleResults] = useState<Record<string, ExecutionResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [detailData, setDetailData] = useState<Record<string, CollectionItem>>({})
  const [editReq, setEditReq] = useState<CollectionItem | null>(null)
  const [isNewReq, setIsNewReq] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => { return () => { unlistenRef.current?.() } }, [])
  useEffect(() => { loadStatuses(); setBatchResult(null); setSingleResults({}); setDetailData({}) }, [collection.id])

  const loadStatuses = async () => {
    try {
      const list = await invoke<ItemLastStatus[]>('get_collection_status', { collectionId: collection.id })
      const map: Record<string, ItemLastStatus> = {}
      for (const s of list) map[s.item_id] = s
      setStatuses(map)
    } catch {}
  }

  // 扁平化请求，chain folder 的 steps 包成 group
  interface FlatReq { id: string; name: string; method: string; folder?: string; expect_status?: number }
  interface StepGroup { groupName: string; groupId: string; isChain: true; steps: FlatReq[] }
  type TableItem = FlatReq | StepGroup
  const tableItems: TableItem[] = []
  function flatten(node: CollectionTreeNode) {
    if (node.node_type === 'request') {
      tableItems.push({ id: node.id, name: node.name, method: node.method ?? 'GET', expect_status: node.expect_status })
    } else if (node.node_type === 'chain') {
      const steps: FlatReq[] = []
      for (const child of node.children) {
        if (child.node_type === 'request') steps.push({ id: child.id, name: child.name, method: child.method ?? 'GET', expect_status: child.expect_status })
      }
      tableItems.push({ groupName: node.name, groupId: node.id, isChain: true, steps })
    } else {
      for (const child of node.children) flatten(child)
    }
  }
  if (tree) for (const child of tree.children) flatten(child)

  // 所有请求（用于统计）
  const allRequests: FlatReq[] = tableItems.flatMap((item) => 'isChain' in item ? item.steps : [item])

  const getStatus = (id: string) => {
    const sr = singleResults[id]
    if (sr) return sr.status
    const br = batchResult?.results.find((x) => x.item_id === id)
    if (br) return br.status
    return statuses[id]?.status
  }
  const total = allRequests.length
  const passed = allRequests.filter((r) => getStatus(r.id) === 'success').length
  const failed = allRequests.filter((r) => { const s = getStatus(r.id); return s && s !== 'success' }).length
  const passRate = (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0
  const progressPercent = batchResult ? 100 : progress.length > 0 ? Math.round((progress.filter((p) => p.status !== 'running').length / (progress[0]?.total ?? 1)) * 100) : 0
  const getResult = (id: string): ExecutionResult | undefined => singleResults[id] ?? batchResult?.results.find((x) => x.item_id === id)

  // 批量运行
  const abortRef = useRef(false)
  const runAll = async () => {
    abortRef.current = false
    setRunning(true); setProgress([]); setBatchResult(null); setSingleResults({}); setError(null); setExpandedRows(new Set())
    unlistenRef.current = await listen<TestProgress>('test-progress', (e) => {
      if (abortRef.current) return
      setProgress((prev) => { const idx = prev.findIndex((x) => x.item_id === e.payload.item_id); if (idx >= 0) { const n = [...prev]; n[idx] = e.payload; return n } return [...prev, e.payload] })
    })
    try {
      const result = await invoke<BatchResult>('run_collection', { collectionId: collection.id, concurrency: 5 })
      if (!abortRef.current) { setBatchResult(result); loadStatuses() }
    } catch (e: any) { if (!abortRef.current) setError(typeof e === 'string' ? e : e.message) }
    finally { setRunning(false); unlistenRef.current?.(); unlistenRef.current = null }
  }

  const stopRun = () => {
    abortRef.current = true
    setRunning(false)
    setProgress([])
    unlistenRef.current?.()
    unlistenRef.current = null
    loadStatuses()
  }

  // 单个运行
  const runSingle = async (requestId: string) => {
    // 清除旧结果，让 UI 立即显示 Running 状态
    setSingleResults((prev) => { const n = { ...prev }; delete n[requestId]; return n })
    setRunningIds((prev) => new Set(prev).add(requestId))
    try {
      const result = await invoke<ExecutionResult>('send_request', { id: requestId })
      setSingleResults((prev) => ({ ...prev, [requestId]: result })); loadStatuses()
    } catch {} finally { setRunningIds((prev) => { const n = new Set(prev); n.delete(requestId); return n }) }
  }

  // 添加测试用例：创建后弹出编辑弹窗
  const addTestCase = async () => {
    const req = await invoke<CollectionItem>('create_item', { collectionId: collection.id, parentId: null, itemType: 'request', name: '新测试用例', method: 'POST' })
    const updated = await invoke<CollectionItem>('update_item', { id: req.id })
    await loadTree(collection.id)
    setIsNewReq(true)
    setEditReq(updated)
  }

  // 添加链
  const addChain = async () => {
    await invoke<CollectionItem>('create_item', { collectionId: collection.id, parentId: null, itemType: 'chain', name: '新链式请求', method: 'GET' })
    await loadTree(collection.id)
  }

  // 添加链步骤
  const addChainStep = async (chainId: string) => {
    const item = await invoke<CollectionItem>('create_item', { collectionId: collection.id, parentId: chainId, itemType: 'request', name: '新步骤', method: 'POST' })
    await loadTree(collection.id)
    setExpandedRows((prev) => {
      const n = new Set(prev)
      // 展开 chain group
      const idx = tableItems.findIndex((t) => 'isChain' in t && (t as StepGroup).groupId === chainId)
      if (idx >= 0) n.add(`group-${idx}`)
      return n
    })
    setIsNewReq(true)
    setEditReq(item)
  }

  // 删除链
  const deleteChain = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm(`确定删除链式请求「${name}」及其所有步骤？`, { title: '删除链', kind: 'warning' })
    if (!ok) return
    await invoke('delete_item', { id })
    await loadTree(collection.id)
  }

  // 删除测试用例
  const deleteRequest = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm(`确定删除测试用例「${name}」？此操作不可撤销。`, { title: '删除测试用例', kind: 'warning' })
    if (!ok) return
    await invoke('delete_item', { id })
    await loadTree(collection.id)
    setExpandedRows((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  // 打开编辑弹窗
  const openEdit = async (id: string) => {
    try {
      const req = await invoke<CollectionItem>('get_item', { id })
      setIsNewReq(false)
      setEditReq(req)
    } catch {}
  }

  // 保存编辑
  const saveEdit = async () => {
    if (!editReq) return
    try {
      const updated = await invoke<CollectionItem>('update_item', {
        id: editReq.id,
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
      })
      await loadTree(collection.id)
      setDetailData((prev) => ({ ...prev, [editReq.id]: updated }))
      setEditReq(null)
      setIsNewReq(false)
    } catch (e: any) {
      console.error('保存失败:', e)
      setError(typeof e === 'string' ? e : e.message || '保存失败')
    }
  }

  // 展开行
  const toggleRow = async (id: string) => {
    const next = new Set(expandedRows)
    if (next.has(id)) { next.delete(id) } else {
      next.add(id)
      if (!detailData[id]) { try { const req = await invoke<CollectionItem>('get_item', { id }); setDetailData((prev) => ({ ...prev, [id]: req })) } catch {} }
    }
    setExpandedRows(next)
  }

  const exportHtml = async () => {
    if (!batchResult) return
    const html = await invoke<string>('export_report_html', { batchResult })
    const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report-${collection.name}-${new Date().toISOString().slice(0, 10)}.html`; a.click(); URL.revokeObjectURL(url)
  }

  const formatTime = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`

  return (
    <div className="px-6 py-6 space-y-5 max-w-5xl mx-auto">
      {/* 头部 */}
      <div>
        <h1 className="text-xl font-bold mb-1.5">{collection.name}</h1>
        <InlineEdit
          value={collection.description}
          placeholder="双击添加描述..."
          onSave={async (v) => {
            await invoke('update_collection', { id: collection.id, description: v })
            await loadTree(collection.id)
          }}
        />
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="TOTAL" value={total} />
        <StatCard label="PASSED" value={passed} color="text-emerald-500" />
        <StatCard label="FAILED" value={failed} color="text-red-500" />
        <div className="rounded-xl border border-overlay/[0.06] p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PASS RATE</span>
          <div className="text-2xl font-bold tabular-nums mt-1" style={{ color: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : passed + failed === 0 ? 'inherit' : '#ef4444' }}>
            {passed + failed > 0 ? `${passRate}%` : '-'}
          </div>
          {passed + failed > 0 && <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${passRate}%`, background: passRate === 100 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444' }} /></div>}
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        {running ? (
          <Button onClick={stopRun} size="sm" variant="destructive" className="gap-1.5">
            <Square className="h-3 w-3" /> 停止
          </Button>
        ) : (
          <Button onClick={runAll} size="sm" className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> 运行全部
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addTestCase}>
          <Plus className="h-3.5 w-3.5" /> 添加用例
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addChain}>
          <Link2 className="h-3.5 w-3.5" /> 添加链
        </Button>
        {batchResult && <Button variant="outline" size="sm" onClick={exportHtml} className="gap-1.5"><Download className="h-3.5 w-3.5" /> 导出报告</Button>}
      </div>

      {running && <div className="space-y-1.5"><div className="flex justify-between text-xs text-muted-foreground"><span>执行中...</span><span>{progressPercent}%</span></div><Progress value={progressPercent} /></div>}
      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>}

      {/* 场景表格 */}
      <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_56px_68px_56px_64px_64px] gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-overlay/[0.04]">
          <span>SCENARIO</span><span>DESCRIPTION</span><span>EXPECT</span><span>STATUS</span><span>HTTP</span><span>TOTAL</span><span />
        </div>
        <div className="max-h-[calc(100vh-420px)] overflow-y-auto divide-y divide-overlay/[0.04]">
          {tableItems.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">暂无测试用例，点击"添加用例"创建</div>
          ) : tableItems.map((item, itemIdx) => {
            if ('isChain' in item) {
              // ─── Chain Group ───
              const groupExpanded = expandedRows.has(`group-${itemIdx}`)
              const groupStatuses = item.steps.map((s) => getStatus(s.id)).filter(Boolean)
              const groupPass = groupStatuses.every((s) => s === 'success')
              const groupFail = groupStatuses.some((s) => s === 'failed' || s === 'error')
              const groupLabel = groupStatuses.length === 0 ? '-' : groupPass ? 'PASS' : groupFail ? 'FAIL' : 'Running'
              const groupColor = groupStatuses.length === 0 ? '' : groupPass ? 'text-emerald-500' : groupFail ? 'text-red-500' : 'text-blue-500'
              return (
                <div key={`group-${itemIdx}`}>
                  {/* Group 头 */}
                  <div
                    className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_56px_68px_56px_64px_64px] gap-2 px-4 py-2.5 text-sm bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer transition-colors group"
                    onClick={() => { const key = `group-${itemIdx}`; setExpandedRows((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n }) }}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {groupExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-amber-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-amber-500" />}
                      <Link2 className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="font-medium truncate text-amber-500/90">{item.groupName}</span>
                      <span className="text-[10px] text-amber-500/50 ml-1">{item.steps.length} steps</span>
                    </span>
                    <span className="text-muted-foreground truncate text-xs self-center">multi-step</span>
                    <span className="font-mono text-xs self-center">-</span>
                    <span className={`flex items-center gap-1 font-bold text-xs ${groupColor}`}>{groupLabel}</span>
                    <span />
                    <span />
                    <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all cursor-pointer" onClick={() => addChainStep(item.groupId)} title="添加步骤">
                        <Plus className="h-3 w-3 text-amber-500" />
                      </button>
                      <button className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => deleteChain(item.groupId, item.groupName, e)} title="删除链">
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </span>
                  </div>
                  {/* Group 内的 Steps */}
                  {groupExpanded && item.steps.map((r, stepIdx) => (
                    <ScenarioRow key={r.id} r={r} stepLabel={`Step ${stepIdx + 1}`} indent getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} toggleRow={toggleRow} runSingle={runSingle} openEdit={openEdit} deleteRequest={deleteRequest} formatTime={formatTime} />
                  ))}
                </div>
              )
            }
            // ─── 普通请求 ───
            return <ScenarioRow key={item.id} r={item} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} toggleRow={toggleRow} runSingle={runSingle} openEdit={openEdit} deleteRequest={deleteRequest} formatTime={formatTime} />
          })}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={!!editReq} onOpenChange={() => { setEditReq(null); setIsNewReq(false) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogClose onClose={() => { setEditReq(null); setIsNewReq(false) }} />
          <DialogHeader><DialogTitle>{isNewReq ? '新建测试用例' : '编辑测试用例'}</DialogTitle></DialogHeader>
          {editReq && <EditForm req={editReq} onChange={setEditReq} onSave={saveEdit} onCancel={() => { setEditReq(null); setIsNewReq(false) }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── 编辑表单 ──────────────────────────────────
function EditForm({ req, onChange, onSave, onCancel }: {
  req: CollectionItem
  onChange: (r: CollectionItem) => void
  onSave: () => void
  onCancel: () => void
}) {
  const set = (field: string, value: any) => onChange({ ...req, [field]: value })

  const formatBody = () => {
    try { set('body_content', JSON.stringify(JSON.parse(req.body_content), null, 2)) } catch {}
  }

  // Tab 键插入 2 空格缩进
  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = req.body_content
      const newVal = val.substring(0, start) + '  ' + val.substring(end)
      set('body_content', newVal)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  // Headers KV 编辑
  const headers: { key: string; value: string; enabled: boolean }[] = (() => {
    try { const p = JSON.parse(req.headers || '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
  })()

  const setHeaders = (h: typeof headers) => set('headers', JSON.stringify(h))

  return (
    <div className="space-y-4">
      {/* 基本信息 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">名称</label>
          <Input value={req.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">描述</label>
          <Input value={req.description} onChange={(e) => set('description', e.target.value)} className="h-8 text-sm" placeholder="场景描述" />
        </div>
      </div>

      {/* Method + URL */}
      <div className="flex gap-2">
        <Select value={req.method} onChange={(v) => set('method', v)} options={['GET','POST','PUT','DELETE','PATCH','HEAD'].map((m) => ({ value: m, label: m }))} className="w-28" />
        <Input value={req.url} onChange={(e) => set('url', e.target.value)} className="h-8 text-sm flex-1" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }} placeholder="请求 URL" />
      </div>

      {/* 期望状态码 */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">期望状态码</label>
        <Input type="number" value={req.expect_status} onChange={(e) => set('expect_status', Number(e.target.value))} className="h-8 w-24 text-sm text-center" />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-muted-foreground">请求体</label>
          <div className="flex items-center gap-1">
            {BODY_TYPES.map((t) => (
              <button key={t.id} className={`px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${req.body_type === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} onClick={() => set('body_type', t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative h-[200px]">
          {req.body_type === 'none' ? (
            <div className="w-full h-full rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] flex items-center justify-center">
              <span className="text-xs text-muted-foreground/40">无请求体</span>
            </div>
          ) : (req.body_type === 'form-data' || req.body_type === 'urlencoded' || req.body_type === 'form') ? (
            <div className="h-full overflow-y-auto">
              <KeyValueTable
                value={(() => { try { const p = JSON.parse(req.body_content || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()}
                onChange={(v) => set('body_content', JSON.stringify(v))}
              />
            </div>
          ) : (
            <>
              <textarea
                value={req.body_content}
                onChange={(e) => set('body_content', e.target.value)}
                onKeyDown={handleBodyKeyDown}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                className="w-full h-full min-h-0 rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 py-2 text-xs leading-relaxed resize-none outline-none hover:border-overlay/[0.12] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all duration-200"
                placeholder='{ "key": "value" }'
              />
              {req.body_type === 'json' && (
                <button
                  onClick={formatBody}
                  className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground bg-overlay/[0.06] hover:bg-overlay/[0.1] cursor-pointer transition-colors"
                >
                  Format
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Headers */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Headers</label>
        <KeyValueTable
          value={headers}
          onChange={setHeaders}
        />
      </div>

      {/* Extract Rules（变量提取） */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">变量提取规则（用于链式请求传递）</label>
        <ExtractRulesEditor
          value={(() => { try { const p = JSON.parse(req.extract_rules || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()}
          onChange={(rules) => set('extract_rules', JSON.stringify(rules))}
        />
      </div>

      {/* 按钮 */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={onSave}>保存</Button>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-overlay/[0.06] p-4">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${color ?? ''}`}>{value}</div>
    </div>
  )
}

// ─── 双击编辑 ──────────────────────────
function InlineEdit({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="h-7 text-xs"
        autoFocus
      />
    )
  }

  return (
    <span
      className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors inline-flex items-center gap-1 group"
      onDoubleClick={() => setEditing(true)}
      title="双击编辑"
    >
      {value || <span className="text-muted-foreground/40 italic">{placeholder}</span>}
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditing(true) }} />
    </span>
  )
}

// ─── 场景行 ──────────────────────────
function ScenarioRow({ r, stepLabel, indent, getResult, getStatus: _getStatus, statuses, progress, runningIds, expandedRows, detailData, toggleRow, runSingle, openEdit, deleteRequest, formatTime }: {
  r: { id: string; name: string; method: string; folder?: string; expect_status?: number }
  stepLabel?: string
  indent?: boolean
  getResult: (id: string) => ExecutionResult | undefined
  getStatus: (id: string) => string | undefined
  statuses: Record<string, ItemLastStatus>
  progress: TestProgress[]
  runningIds: Set<string>
  expandedRows: Set<string>
  detailData: Record<string, CollectionItem>
  toggleRow: (id: string) => void
  runSingle: (id: string) => void
  openEdit: (id: string) => void
  deleteRequest: (id: string, name: string, e: React.MouseEvent) => void
  formatTime: (ms: number) => string
}) {
  const result = getResult(r.id)
  const prog = progress.find((p) => p.item_id === r.id)
  const old = statuses[r.id]
  const resp = result?.response
  const status = result?.status ?? prog?.status ?? old?.status
  const expanded = expandedRows.has(r.id)
  const isRunning = runningIds.has(r.id) || prog?.status === 'running'
  const detail = detailData[r.id]
  const sd = !status ? { icon: <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />, label: '-', color: '' }
    : status === 'running' ? { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />, label: 'Running', color: 'text-blue-500' }
    : status === 'success' ? { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'PASS', color: 'text-emerald-500' }
    : status === 'failed' ? { icon: <XCircle className="h-3.5 w-3.5" />, label: 'FAIL', color: 'text-red-500' }
    : { icon: <AlertCircle className="h-3.5 w-3.5" />, label: 'ERR', color: 'text-amber-500' }

  return (
    <div>
      <div className={`grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_56px_68px_56px_64px_64px] gap-2 px-4 py-2.5 text-sm hover:bg-overlay/[0.03] cursor-pointer transition-colors group ${indent ? 'pl-10 bg-overlay/[0.02]' : ''}`} onClick={() => toggleRow(r.id)}>
        <span className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {stepLabel && <span className="text-[10px] text-amber-500/70 font-mono shrink-0">{stepLabel}</span>}
          <span className="font-medium truncate">{r.name}</span>
        </span>
        <span className="text-muted-foreground truncate text-xs self-center">{r.folder || '-'}</span>
        <span className="font-mono text-xs self-center">{r.expect_status || 200}</span>
        <span className={`flex items-center gap-1 font-bold text-xs ${sd.color}`}>{sd.icon}{sd.label}</span>
        <span className="font-mono text-xs self-center">
          {resp ? <span className={resp.status < 300 ? 'text-emerald-500' : resp.status < 400 ? 'text-amber-500' : 'text-red-500'}>{resp.status}</span> : '-'}
        </span>
        <span className="text-xs text-muted-foreground self-center tabular-nums">{resp ? formatTime(resp.time_ms) : old ? formatTime(old.response_time_ms) : '-'}</span>
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all cursor-pointer" onClick={() => runSingle(r.id)} disabled={isRunning} title="运行">
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : <Play className="h-3 w-3 text-muted-foreground" />}
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all cursor-pointer" onClick={() => openEdit(r.id)} title="编辑">
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => deleteRequest(r.id, r.name, e)} title="删除">
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className={`bg-overlay/[0.03] px-4 py-4 space-y-4 border-t border-overlay/[0.04] ${indent ? 'ml-6' : ''}`}>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-overlay/[0.04]">USER REQUEST</div>
              <pre className="px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all max-h-52 overflow-y-auto">
                {detail ? (() => { const p = [`${detail.method} ${detail.url}`]; if (detail.body_type !== 'none' && detail.body_content) { try { p.push(JSON.stringify(JSON.parse(detail.body_content), null, 2)) } catch { p.push(detail.body_content) } } return p.join('\n\n') })() : '加载中...'}
              </pre>
            </div>
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-overlay/[0.04] flex items-center gap-2">USER RESPONSE {resp && <span className="text-[9px] font-normal normal-case">{resp.status} | {resp.size_bytes}B</span>}</div>
              {resp && resp.headers.length > 0 && (
                <details className="border-b border-overlay/[0.04]">
                  <summary className="px-3 py-1.5 text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors">
                    Response Headers ({resp.headers.length})
                  </summary>
                  <div className="px-3 py-1.5 text-[10px] font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {resp.headers.map((h: { key: string; value: string }, hi: number) => (
                      <div key={hi} className="flex gap-2">
                        <span className="text-primary/70 shrink-0">{h.key}:</span>
                        <span className="text-muted-foreground break-all">{h.value}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <pre className="px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all max-h-52 overflow-y-auto">
                {resp ? (() => { try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { return resp.body } })() : '尚未运行'}
              </pre>
            </div>
          </div>
          {result && result.assertion_results.length > 0 && (
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-overlay/[0.04]">ASSERTIONS ({result.assertion_results.filter((a) => a.passed).length}/{result.assertion_results.length})</div>
              <div className="px-3 py-2 space-y-1">{result.assertion_results.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  {a.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                  <span>{a.message}</span>{!a.passed && a.actual && <span className="text-muted-foreground">(actual: {a.actual})</span>}
                </div>
              ))}</div>
            </div>
          )}
          {result?.error_message && <div className="flex items-start gap-1.5 text-xs text-red-500"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{result.error_message}</div>}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground/80 pt-1">
            {detail?.created_at && <span>创建: {detail.created_at}</span>}
            {detail?.updated_at && <span>更新: {detail.updated_at}</span>}
            {old?.executed_at && <span>最近运行: {old.executed_at}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 变量提取规则编辑器 ──────────────────────────
function ExtractRulesEditor({ value, onChange }: {
  value: { var_name: string; source: string; expression: string }[]
  onChange: (rules: { var_name: string; source: string; expression: string }[]) => void
}) {
  const addRule = () => onChange([...value, { var_name: '', source: 'json_body', expression: '' }])
  const removeRule = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const updateRule = (idx: number, field: string, val: string) => {
    const updated = [...value]
    updated[idx] = { ...updated[idx], [field]: val }
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      {value.map((rule, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={rule.var_name} onChange={(e) => updateRule(i, 'var_name', e.target.value)} className="h-7 text-xs flex-1" placeholder="变量名 (如 task_id)" />
          <Select value={rule.source} onChange={(v) => updateRule(i, 'source', v)} options={[
            { value: 'json_body', label: 'JSON Body' },
            { value: 'header', label: 'Header' },
            { value: 'status_code', label: 'Status Code' },
          ]} className="w-32" />
          <Input value={rule.expression} onChange={(e) => updateRule(i, 'expression', e.target.value)} className="h-7 text-xs flex-1" placeholder="表达式 (如 $.data.id)" />
          <button onClick={() => removeRule(i)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 cursor-pointer transition-colors shrink-0">
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </div>
      ))}
      <button onClick={addRule} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
        <Plus className="h-3 w-3" /> 添加提取规则
      </button>
      {value.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60">提取的变量可在后续步骤中通过 {'{{变量名}}'} 引用</p>
      )}
    </div>
  )
}
