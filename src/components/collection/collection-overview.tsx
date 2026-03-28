import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Play, Download, CheckCircle2, XCircle, AlertCircle, Circle,
  ChevronDown, ChevronRight, Loader2, Plus, Trash2, Pencil, Link2, Square, Zap, ListOrdered,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { JsonHighlight } from '@/components/ui/json-highlight'
import { JsonEditor } from '@/components/ui/json-editor'
import { VarHighlight } from '@/components/ui/var-highlight'
import EnvSelector from '@/components/layout/env-selector'
import KeyValueTable from '@/components/request/key-value-table'
import { Progress } from '@/components/ui/progress'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { useCollectionStore } from '@/stores/collection-store'
import type {
  Collection, CollectionTreeNode, ItemLastStatus,
  BatchResult, TestProgress, ExecutionResult, CollectionItem, HttpResponse,
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
  const [runMode, setRunMode] = useState<'concurrent' | 'sequential'>('concurrent')
  const [delayMs, setDelayMs] = useState(0)
  const [showRunSettings, setShowRunSettings] = useState(false)
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => { return () => { unlistenRef.current?.() } }, [])
  useEffect(() => { loadStatuses(); setBatchResult(null); setSingleResults({}); setDetailData({}) }, [collection.id])

  useEffect(() => {
    (async () => {
      try {
        const envs = await invoke<{ id: string; name: string; is_active: boolean }[]>('list_environments')
        const active = envs.find((e) => e.is_active)
        if (active) {
          const data = await invoke<{ variables: { key: string; value: string; enabled: boolean }[] }>('get_environment_with_vars', { id: active.id })
          const map: Record<string, string> = {}
          for (const v of data.variables) if (v.enabled) map[v.key] = v.value
          setEnvVars(map)
        }
      } catch {}
    })()
  }, [])

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

    if (runMode === 'sequential') {
      // 顺序执行 + delay
      for (const item of allRequests) {
        if (abortRef.current) break
        setRunningIds((prev) => new Set(prev).add(item.id))
        try {
          const result = await invoke<ExecutionResult>('send_request', { id: item.id })
          setSingleResults((prev) => ({ ...prev, [item.id]: result }))
        } catch {}
        setRunningIds((prev) => { const n = new Set(prev); n.delete(item.id); return n })
        // delay
        if (delayMs > 0 && !abortRef.current) {
          await new Promise((r) => setTimeout(r, delayMs))
        }
      }
      setRunning(false)
      loadStatuses()
    } else {
      // 并发执行（原有逻辑）
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

  // 添加测试用例：先弹编辑框，保存时才创建记录
  const addTestCase = () => {
    setIsNewReq(true)
    setEditReq({
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
    })
  }

  // 添加链：简单弹框只填名称+描述
  const [showChainDialog, setShowChainDialog] = useState(false)
  const [chainName, setChainName] = useState('')
  const [chainDesc, setChainDesc] = useState('')
  const addChain = () => { setChainName(''); setChainDesc(''); setShowChainDialog(true) }
  const saveChain = async () => {
    if (!chainName.trim()) return
    await invoke('create_item', { collectionId: collection.id, parentId: null, itemType: 'chain', name: chainName.trim(), method: 'GET' })
    await loadTree(collection.id)
    setShowChainDialog(false)
  }

  // 添加链步骤（只构建临时对象，saveEdit 时才真正创建）
  const addChainStep = async (chainId: string) => {
    setExpandedRows((prev) => {
      const n = new Set(prev)
      const idx = tableItems.findIndex((t) => 'isChain' in t && (t as StepGroup).groupId === chainId)
      if (idx >= 0) n.add(`group-${idx}`)
      return n
    })
    setIsNewReq(true)
    setEditReq({
      id: '',
      collection_id: collection.id,
      parent_id: chainId,
      type: 'request',
      name: '新步骤',
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
    } as CollectionItem)
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
    if (!editReq.name.trim()) { return }
    try {
      if (isNewReq) {
        // 新建：先创建记录再更新详情
        const created = await invoke<CollectionItem>('create_item', {
          collectionId: collection.id,
          parentId: editReq.parent_id,
          itemType: editReq.type,
          name: editReq.name,
          method: editReq.method,
        })
        await invoke('update_item', {
          id: created.id,
          url: editReq.url,
          headers: editReq.headers,
          queryParams: editReq.query_params,
          bodyType: editReq.body_type,
          bodyContent: editReq.body_content,
          extractRules: editReq.extract_rules,
          description: editReq.description,
          expectStatus: editReq.expect_status,
        })
      } else {
        // 编辑：直接更新
        await invoke('update_item', {
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
      }
      await loadTree(collection.id)
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
        <div className="flex items-center gap-2 flex-1">
        {running ? (
          <Button onClick={stopRun} size="sm" variant="destructive" className="gap-1.5">
            <Square className="h-3 w-3" /> 停止
          </Button>
        ) : (
          <div className="relative">
            <Button onClick={runAll} size="sm" className="gap-1.5 pr-1">
              <Play className="h-3.5 w-3.5" /> 运行全部
              <span className="w-px h-4 bg-primary-foreground/20 mx-0.5" />
              <span onClick={(e) => { e.stopPropagation(); setShowRunSettings(!showRunSettings) }} className="p-0.5 rounded hover:bg-primary-foreground/10 cursor-pointer">
                <ChevronDown className="h-3 w-3" />
              </span>
            </Button>
            {showRunSettings && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRunSettings(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg border border-overlay/[0.1] bg-background shadow-xl p-1.5 space-y-1">
                  <button onClick={() => setRunMode('concurrent')} className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${runMode === 'concurrent' ? 'bg-primary/10 text-primary' : 'hover:bg-overlay/[0.04]'}`}>
                    <Zap className="h-3.5 w-3.5" /> 并发执行
                  </button>
                  <button onClick={() => setRunMode('sequential')} className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${runMode === 'sequential' ? 'bg-primary/10 text-primary' : 'hover:bg-overlay/[0.04]'}`}>
                    <ListOrdered className="h-3.5 w-3.5" /> 顺序执行
                  </button>
                  {runMode === 'sequential' && (
                    <div className="px-2.5 py-2 border-t border-overlay/[0.06] mt-1 space-y-1.5">
                      <div className="text-[10px] text-muted-foreground">请求间隔</div>
                      <div className="flex gap-1">
                        {[0, 200, 500, 1000, 2000, 5000].map((ms) => (
                          <button
                            key={ms}
                            onClick={() => setDelayMs(ms)}
                            className={`px-2 py-1 rounded text-[10px] cursor-pointer transition-colors ${delayMs === ms ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-overlay/[0.04]'}`}
                          >
                            {ms === 0 ? '无' : ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
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
          <Plus className="h-3.5 w-3.5" /> 添加用例
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addChain}>
          <Link2 className="h-3.5 w-3.5" /> 添加链
        </Button>
        {batchResult && <Button variant="outline" size="sm" onClick={exportHtml} className="gap-1.5"><Download className="h-3.5 w-3.5" /> 导出报告</Button>}
        </div>
        <EnvSelector />
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
                    <ScenarioRow key={r.id} r={r} stepLabel={`Step ${stepIdx + 1}`} indent envVars={envVars} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} toggleRow={toggleRow} runSingle={runSingle} openEdit={openEdit} deleteRequest={deleteRequest} formatTime={formatTime} />
                  ))}
                </div>
              )
            }
            // ─── 普通请求 ───
            return <ScenarioRow key={item.id} r={item} envVars={envVars} getResult={getResult} getStatus={getStatus} statuses={statuses} progress={progress} runningIds={runningIds} expandedRows={expandedRows} detailData={detailData} toggleRow={toggleRow} runSingle={runSingle} openEdit={openEdit} deleteRequest={deleteRequest} formatTime={formatTime} />
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

      {/* 新建链弹窗 — 简洁版 */}
      <Dialog open={showChainDialog} onOpenChange={setShowChainDialog}>
        <DialogContent className="max-w-sm">
          <DialogClose onClose={() => setShowChainDialog(false)} />
          <DialogHeader><DialogTitle>新建链式请求</DialogTitle></DialogHeader>
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
              创建后可在表格中展开链，通过"+ 添加步骤"逐个添加请求。步骤间通过变量提取规则（Extract）传递数据，后续步骤用 {'{{变量名}}'} 引用。
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowChainDialog(false)}>取消</Button>
              <Button size="sm" onClick={saveChain} disabled={!chainName.trim()}>创建</Button>
            </div>
          </div>
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
  const [showCurlImport, setShowCurlImport] = useState(false)
  const [curlInput, setCurlInput] = useState('')

  const formatBody = () => {
    try { set('body_content', JSON.stringify(JSON.parse(req.body_content), null, 2)) } catch {}
  }

  const importFromCurl = async () => {
    if (!curlInput.trim()) return
    try {
      const parsed = await invoke<any>('parse_curl', { curlCommand: curlInput })
      onChange({
        ...req,
        method: parsed.method || req.method,
        url: parsed.url || req.url,
        headers: JSON.stringify(parsed.headers || []),
        body_type: parsed.body_type || req.body_type,
        body_content: parsed.body_content || req.body_content,
      })
      setShowCurlImport(false)
      setCurlInput('')
    } catch (e: any) {
      alert(`解析失败: ${e}`)
    }
  }

  const exportToCurl = () => {
    const headers: { key: string; value: string; enabled: boolean }[] = (() => { try { return JSON.parse(req.headers || '[]') } catch { return [] } })()
    const parts = [`curl -X ${req.method}`, `  '${req.url}'`]
    for (const h of headers.filter((h) => h.enabled)) parts.push(`  -H '${h.key}: ${h.value}'`)
    if (req.body_type !== 'none' && req.body_content) {
      try { parts.push(`  -d '${JSON.stringify(JSON.parse(req.body_content))}'`) } catch { parts.push(`  -d '${req.body_content}'`) }
    }
    const curl = parts.join(' \\\n')
    navigator.clipboard.writeText(curl)
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
                allowFiles={req.body_type === 'form-data'}
              />
            </div>
          ) : req.body_type === 'json' ? (
            <>
              <JsonEditor
                value={req.body_content}
                onChange={(v) => set('body_content', v)}
                className="w-full h-full"
                placeholder='{ "key": "value" }'
              />
              <button
                onClick={formatBody}
                className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground bg-overlay/[0.06] hover:bg-overlay/[0.1] cursor-pointer transition-colors z-20"
              >
                Format
              </button>
            </>
          ) : (
            <textarea
              value={req.body_content}
              onChange={(e) => set('body_content', e.target.value)}
              onKeyDown={handleBodyKeyDown}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              className="w-full h-full min-h-0 rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 py-2 text-xs leading-relaxed resize-none outline-none hover:border-overlay/[0.12] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all duration-200"
              placeholder="请求体内容"
            />
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

      {/* 轮询配置 */}
      <PollConfigEditor
        value={(() => { try { return req.poll_config ? JSON.parse(req.poll_config) : null } catch { return null } })()}
        onChange={(cfg) => set('poll_config', cfg ? JSON.stringify(cfg) : '')}
      />

      {/* curl 导入 */}
      {showCurlImport && (
        <div className="space-y-2 p-3 rounded-lg border border-overlay/[0.08] bg-overlay/[0.02]">
          <label className="text-xs text-muted-foreground">粘贴 curl 命令</label>
          <textarea
            value={curlInput}
            onChange={(e) => setCurlInput(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-overlay/[0.08] bg-transparent px-3 py-2 text-xs resize-y outline-none focus:border-primary/50"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            placeholder={'curl -X POST https://api.example.com \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"key":"value"}\''}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={importFromCurl} disabled={!curlInput.trim()}>解析导入</Button>
            <Button variant="outline" size="sm" onClick={() => setShowCurlImport(false)}>取消</Button>
          </div>
        </div>
      )}

      {/* 按钮 */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-2">
          <button onClick={() => setShowCurlImport(!showCurlImport)} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            从 curl 导入
          </button>
          {req.id && req.url && (
            <button onClick={exportToCurl} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
              复制 curl
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
          <Button size="sm" onClick={onSave}>保存</Button>
        </div>
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
function ScenarioRow({ r, stepLabel, indent, envVars = {}, getResult, getStatus: _getStatus, statuses, progress, runningIds, expandedRows, detailData, toggleRow, runSingle, openEdit, deleteRequest, formatTime }: {
  r: { id: string; name: string; method: string; folder?: string; expect_status?: number }
  stepLabel?: string
  indent?: boolean
  envVars?: Record<string, string>
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
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body')
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
              <div className="px-3 py-2.5 max-h-52 overflow-y-auto">
                {detail ? (
                  <>
                    <div className="text-xs font-mono mb-2">
                      <span className="text-method-post font-bold">{detail.method}</span>{' '}
                      <VarHighlight text={detail.url} vars={envVars} className="text-xs font-mono" />
                    </div>
                    {detail.body_type !== 'none' && detail.body_content && (
                      <JsonHighlight code={(() => { try { return JSON.stringify(JSON.parse(detail.body_content), null, 2) } catch { return detail.body_content } })()} />
                    )}
                  </>
                ) : <span className="text-xs text-muted-foreground">加载中...</span>}
              </div>
            </div>
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              {/* Tab 栏：Body / Headers + 状态信息 */}
              <div className="flex items-center justify-between border-b border-overlay/[0.04] px-3">
                <div className="flex items-center gap-0">
                  <button className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${respTab === 'body' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setRespTab('body')}>
                    Body
                    {respTab === 'body' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                  <button className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${respTab === 'headers' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setRespTab('headers')}>
                    Headers{resp ? ` (${resp.headers.length})` : ''}
                    {respTab === 'headers' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                </div>
                {resp && (
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className={resp.status < 300 ? 'text-emerald-500 font-bold' : resp.status < 400 ? 'text-amber-500 font-bold' : 'text-red-500 font-bold'}>{resp.status} {resp.status_text}</span>
                    <span className="text-muted-foreground">{formatTime(resp.time_ms)}</span>
                    <span className="text-muted-foreground">{resp.size_bytes > 1024 ? `${(resp.size_bytes / 1024).toFixed(1)}KB` : `${resp.size_bytes}B`}</span>
                  </div>
                )}
              </div>
              {/* Tab 内容 */}
              {respTab === 'body' ? (
                <ResponseBody resp={resp} />
              ) : (
                <div className="max-h-52 overflow-y-auto">
                  {resp && resp.headers.length > 0 ? (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-overlay/[0.04]">
                          <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-1/3">Key</th>
                          <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Value</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {resp.headers.map((h: { key: string; value: string }, hi: number) => (
                          <tr key={hi} className="border-b border-overlay/[0.02] hover:bg-overlay/[0.03] transition-colors">
                            <td className="px-3 py-1 text-primary/80 align-top">{h.key}</td>
                            <td className="px-3 py-1 text-muted-foreground break-all">
                              <VarHighlight text={h.value} vars={envVars} className="text-[11px] font-mono" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground/40">尚未运行</div>
                  )}
                </div>
              )}
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

// ─── 轮询配置编辑器 ──────────────────────────
function PollConfigEditor({ value, onChange }: {
  value: { field: string; target: string; interval_seconds: number; max_seconds: number } | null
  onChange: (cfg: { field: string; target: string; interval_seconds: number; max_seconds: number } | null) => void
}) {
  const enabled = value !== null

  const toggle = () => {
    if (enabled) {
      onChange(null)
    } else {
      onChange({ field: '', target: '', interval_seconds: 5, max_seconds: 60 })
    }
  }

  const update = (field: string, val: string | number) => {
    if (!value) return
    onChange({ ...value, [field]: val })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-xs text-muted-foreground">轮询等待配置</label>
        <button
          onClick={toggle}
          className={`px-2 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${enabled ? 'bg-amber-500/15 text-amber-500' : 'bg-overlay/[0.04] text-muted-foreground hover:text-foreground'}`}
        >
          {enabled ? '已启用' : '未启用'}
        </button>
      </div>
      {enabled && value && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-overlay/[0.06] bg-overlay/[0.02]">
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">检查字段</label>
            <Input value={value.field} onChange={(e) => update('field', e.target.value)} className="h-7 text-xs" placeholder="如 status" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">目标值</label>
            <Input value={value.target} onChange={(e) => update('target', e.target.value)} className="h-7 text-xs" placeholder="如 completed" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">轮询间隔（秒）</label>
            <Input type="number" value={value.interval_seconds} onChange={(e) => update('interval_seconds', Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">最大等待（秒）</label>
            <Input type="number" value={value.max_seconds} onChange={(e) => update('max_seconds', Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <p className="col-span-2 text-[10px] text-muted-foreground/60">
            每隔 {value.interval_seconds}s 请求一次，检查响应 JSON 中 "{value.field}" 是否等于 "{value.target}"，最多等待 {value.max_seconds}s
          </p>
        </div>
      )}
    </div>
  )
}

function ResponseBody({ resp }: { resp: HttpResponse | null | undefined }) {
  if (!resp) return <div className="px-3 py-6 text-center text-xs text-muted-foreground/40">尚未运行</div>

  const contentType = resp.headers.find((h: { key: string }) => h.key.toLowerCase() === 'content-type')?.value?.toLowerCase() || ''

  // 图片
  if (contentType.startsWith('image/')) {
    const blob = new Blob([Uint8Array.from(atob(resp.body), c => c.charCodeAt(0))], { type: contentType })
    const url = URL.createObjectURL(blob)
    return (
      <div className="p-3 flex items-center justify-center max-h-64 overflow-hidden">
        <img src={url} alt="response" className="max-h-56 max-w-full object-contain rounded" onLoad={() => URL.revokeObjectURL(url)} />
      </div>
    )
  }

  // 音频
  if (contentType.startsWith('audio/')) {
    return (
      <div className="p-3 flex items-center justify-center">
        <audio controls className="w-full max-w-md">
          <source type={contentType} />
          浏览器不支持音频播放
        </audio>
      </div>
    )
  }

  // 视频
  if (contentType.startsWith('video/')) {
    return (
      <div className="p-3 flex items-center justify-center">
        <video controls className="max-h-56 max-w-full rounded">
          <source type={contentType} />
          浏览器不支持视频播放
        </video>
      </div>
    )
  }

  // HTML
  if (contentType.includes('text/html')) {
    return (
      <div className="max-h-52 overflow-y-auto">
        <iframe srcDoc={resp.body} className="w-full h-52 border-0" sandbox="" title="HTML Preview" />
      </div>
    )
  }

  // JSON（默认尝试格式化）
  const formatted = (() => {
    try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { return resp.body }
  })()

  return <JsonHighlight code={formatted} className="px-3 py-2.5 max-h-52 overflow-y-auto" />
}
