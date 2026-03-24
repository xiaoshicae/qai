import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Play, CheckCircle, XCircle, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import { useCollectionStore } from '@/stores/collection-store'
import { useTabsStore } from '@/stores/tabs-store'
import type { Collection, CollectionTreeNode, RequestLastStatus } from '@/types'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

interface Props {
  collection: Collection
  tree: CollectionTreeNode | undefined
}

export default function CollectionOverview({ collection, tree }: Props) {
  const navigate = useNavigate()
  const { selectNode } = useCollectionStore()
  const { openTab } = useTabsStore()
  const [statuses, setStatuses] = useState<Record<string, RequestLastStatus>>({})
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'none'>('all')

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<RequestLastStatus[]>('get_collection_status', { collectionId: collection.id })
        const map: Record<string, RequestLastStatus> = {}
        for (const s of list) map[s.request_id] = s
        setStatuses(map)
      } catch {}
    })()
  }, [collection.id])

  // 扁平化所有请求
  const requests: { id: string; name: string; method: string }[] = []
  function flatten(node: CollectionTreeNode) {
    if (node.node_type === 'request') {
      requests.push({ id: node.id, name: node.name, method: node.method ?? 'GET' })
    }
    for (const child of node.children) flatten(child)
  }
  if (tree) for (const child of tree.children) flatten(child)

  const filtered = requests.filter((r) => {
    const s = statuses[r.id]
    if (filter === 'passed') return s?.status === 'success'
    if (filter === 'failed') return s?.status === 'failed'
    if (filter === 'none') return !s
    return true
  })

  const total = requests.length
  const passed = requests.filter((r) => statuses[r.id]?.status === 'success').length
  const failed = requests.filter((r) => statuses[r.id]?.status === 'failed').length
  const notRun = total - passed - failed

  const handleClick = (r: { id: string; name: string; method: string }) => {
    navigate('/')
    selectNode(r.id)
    openTab(r.id, r.name, r.method)
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">{collection.name}</h1>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => navigate('/runner', { state: { collectionId: collection.id } })}
        >
          <Play className="h-3.5 w-3.5" /> 运行全部
        </Button>
      </div>

      {/* 统计 */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <span className="text-muted-foreground">{total} 个用例</span>
        <span className="text-emerald-500">{passed} 通过</span>
        <span className="text-red-500">{failed} 失败</span>
        <span className="text-muted-foreground">{notRun} 未运行</span>
      </div>

      {/* 筛选 */}
      <div className="flex gap-1 mb-4">
        {(['all', 'passed', 'failed', 'none'] as const).map((f) => (
          <button
            key={f}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              filter === f ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setFilter(f)}
          >
            {{ all: '全部', passed: '通过', failed: '失败', none: '未运行' }[f]}
          </button>
        ))}
      </div>

      {/* 用例列表 */}
      {filtered.length > 0 ? (
        <div className="rounded-xl ring-1 ring-foreground/10 overflow-hidden">
          {filtered.map((r, i) => {
            const s = statuses[r.id]
            const method = r.method.toUpperCase()
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 ${
                  i % 2 === 0 ? 'bg-card' : 'bg-transparent'
                }`}
                onClick={() => handleClick(r)}
              >
                {s ? (
                  s.status === 'success'
                    ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                )}
                <span className={`text-[10px] font-bold font-mono w-10 shrink-0 ${METHOD_COLORS[method] ?? ''}`}>{method}</span>
                <span className="text-sm truncate flex-1">{r.name}</span>
                {s && (
                  <>
                    {s.assertion_total > 0 && (
                      <span className={`text-xs ${s.assertion_passed === s.assertion_total ? 'text-emerald-500' : 'text-red-500'}`}>
                        {s.assertion_passed}/{s.assertion_total}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">{s.response_time_ms}ms</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-12">
          {filter === 'all' ? '暂无请求' : '没有匹配的用例'}
        </div>
      )}
    </div>
  )
}
