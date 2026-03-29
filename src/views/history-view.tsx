import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  Clock, Search, ChevronDown, ChevronRight, Trash2, ExternalLink,
  CheckCircle, XCircle, AlertCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { useCollectionStore } from '@/stores/collection-store'
import { useTabsStore } from '@/stores/tabs-store'
import { formatDuration, formatSize } from '@/lib/formatters'
import type { HistoryEntry, HistoryStats, AssertionResultItem } from '@/types'

const PAGE_SIZE = 50

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

const STATUS_FILTERS = ['all', 'success', 'failed', 'error'] as const
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']

export default function HistoryView() {
  const { t } = useTranslation()
  const { selectNode } = useCollectionStore()
  const { openTab } = useTabsStore()
  const confirmFn = useConfirmStore((s) => s.confirm)

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState<HistoryStats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 筛选状态
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [methodFilter, setMethodFilter] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // 搜索防抖
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedKeyword(keyword), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [keyword])

  const fetchEntries = useCallback(async (offset: number, append: boolean) => {
    try {
      const list = await invoke<HistoryEntry[]>('list_history_filtered', {
        status: statusFilter === 'all' ? null : statusFilter,
        method: methodFilter || null,
        keyword: debouncedKeyword.trim() || null,
        limit: PAGE_SIZE,
        offset,
      })
      setEntries((prev) => append ? [...prev, ...list] : list)
      setHasMore(list.length === PAGE_SIZE)
    } catch {
      // 静默处理
    }
    setLoaded(true)
  }, [statusFilter, methodFilter, debouncedKeyword])

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<HistoryStats>('history_stats')
      setStats(s)
    } catch {
      // 静默处理
    }
  }, [])

  // 筛选条件变化时重新加载
  useEffect(() => {
    setLoaded(false)
    setExpandedId(null)
    fetchEntries(0, false)
  }, [fetchEntries])

  // 初始加载统计
  useEffect(() => { fetchStats() }, [fetchStats])

  const loadMore = () => fetchEntries(entries.length, true)

  const handleGoToRequest = (entry: HistoryEntry) => {
    if (entry.item_id) {
      selectNode(entry.item_id)
      openTab(entry.item_id, entry.item_name || entry.request_url || 'Request', entry.request_method)
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirmFn(t('history.confirm_delete'), { title: t('common.delete'), kind: 'warning' })
    if (!ok) return
    try {
      await invoke('delete_history', { id })
      setEntries((prev) => prev.filter((e) => e.id !== id))
      fetchStats()
    } catch {
      // 静默处理
    }
  }

  const handleClearAll = async () => {
    const ok = await confirmFn(t('history.confirm_clear'), { title: t('history.clear_all'), kind: 'warning' })
    if (!ok) return
    try {
      await invoke('clear_history')
      setEntries([])
      setHasMore(false)
      fetchStats()
    } catch {
      // 静默处理
    }
  }

  const formatTime = (s: string) => {
    try {
      const d = new Date(s + 'Z')
      const now = Date.now()
      const diff = now - d.getTime()
      if (diff < 0 || isNaN(diff)) return '-'
      if (diff < 60000) return t('history.just_now')
      if (diff < 3600000) return t('history.minutes_ago', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return t('history.hours_ago', { n: Math.floor(diff / 3600000) })
      if (diff < 604800000) return t('history.days_ago', { n: Math.floor(diff / 86400000) })
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch { return s }
  }

  const methodOptions = [
    { value: '', label: t('history.all_methods') },
    ...METHOD_OPTIONS.map((m) => ({ value: m, label: m })),
  ]

  // 统计条基于全局 stats（chips 显示各状态计数），成功率基于全局
  const successRate = stats && stats.total > 0
    ? Math.round((stats.success_count / stats.total) * 100)
    : 0

  // chips 上显示计数
  const statusCounts: Record<string, number> = {
    all: stats?.total ?? 0,
    success: stats?.success_count ?? 0,
    failed: stats?.failed_count ?? 0,
    error: stats?.error_count ?? 0,
  }

  if (!loaded) return null

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 h-full overflow-y-auto">
      {/* 标题 + 清空按钮 */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold">{t('history.title')}</h1>
        {stats && stats.total > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleClearAll}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('history.clear_all')}
          </Button>
        )}
      </div>

      {/* 搜索 + 筛选栏 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t('history.search_placeholder')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <Select
          value={methodFilter}
          onChange={setMethodFilter}
          options={methodOptions}
          className="w-[130px]"
        />
      </div>

      {/* 状态筛选 chips + 统计 */}
      <div className="flex items-center gap-2 mb-4">
        {STATUS_FILTERS.map((s) => {
          const active = statusFilter === s
          const count = statusCounts[s] ?? 0
          return (
            <button
              key={s}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
                active
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'bg-overlay/[0.04] text-muted-foreground border border-transparent hover:bg-overlay/[0.06]'
              }`}
              onClick={() => setStatusFilter(s)}
            >
              {t(`history.filter_${s}`)}
              {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
            </button>
          )
        })}

        {stats && stats.total > 0 && (
          <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
            <span className={successRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : successRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
              {t('history.stats_success_rate', { rate: successRate })}
            </span>
            <span className="h-3 w-px bg-overlay/[0.1]" />
            <span>{t('history.stats_avg_time', { ms: stats.avg_time_ms })}</span>
          </div>
        )}
      </div>

      {/* 列表 */}
      {entries.length === 0 ? (
        keyword || statusFilter !== 'all' || methodFilter ? (
          <EmptyState icon={Search} title={t('history.no_results')} />
        ) : (
          <EmptyState icon={Clock} title={t('history.empty')} description={t('history.empty_hint')} />
        )
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onGoTo={() => handleGoToRequest(entry)}
              onDelete={() => handleDelete(entry.id)}
              formatTime={formatTime}
              t={t}
            />
          ))}
        </div>
      )}

      {/* 加载更多 */}
      {entries.length > 0 && (
        <div className="flex justify-center mt-4">
          {hasMore ? (
            <Button variant="ghost" size="sm" onClick={loadMore}>
              {t('history.load_more')}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground/50">{t('history.no_more')}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 单条历史记录组件 ───────────────────────

interface HistoryRowProps {
  entry: HistoryEntry
  expanded: boolean
  onToggle: () => void
  onGoTo: () => void
  onDelete: () => void
  formatTime: (s: string) => string
  t: (key: string, opts?: Record<string, unknown>) => string
}

function HistoryRow({ entry, expanded, onToggle, onGoTo, onDelete, formatTime, t }: HistoryRowProps) {
  const method = entry.request_method?.toUpperCase() ?? ''
  const color = METHOD_COLORS[method] ?? 'text-muted-foreground'
  const isSuccess = entry.status === 'success'
  const isError = entry.status === 'error'

  const assertions: AssertionResultItem[] = (() => {
    try { return JSON.parse(entry.assertion_results) } catch { return [] }
  })()
  const passedCount = assertions.filter((a) => a.passed).length

  return (
    <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
      {/* 摘要行 */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-overlay/[0.04]"
        onClick={onToggle}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        }

        {/* 状态图标 */}
        {isSuccess ? (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : isError ? (
          <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        )}

        {/* 方法 */}
        <span className={`text-[10px] font-bold font-mono w-12 shrink-0 ${color}`}>{method}</span>

        {/* 名称 + URL */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {entry.item_name && (
            <span className="text-sm font-medium truncate max-w-[200px]">{entry.item_name}</span>
          )}
          <span className="text-xs text-muted-foreground font-mono truncate">
            {entry.request_url || '—'}
          </span>
        </div>

        {/* 状态码 */}
        {entry.response_status != null && (
          <Badge variant={entry.response_status < 400 ? 'success' : 'destructive'} className="text-[10px]">
            {entry.response_status}
          </Badge>
        )}

        {/* 断言 */}
        {assertions.length > 0 && (
          <span className={`text-xs shrink-0 ${passedCount === assertions.length ? 'text-emerald-500' : 'text-red-500'}`}>
            {passedCount}/{assertions.length}
          </span>
        )}

        {/* 耗时 */}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatDuration(entry.response_time_ms)}
        </span>

        {/* 时间 */}
        <span className="text-[11px] text-muted-foreground/50 shrink-0 w-[80px] text-right">
          {formatTime(entry.executed_at)}
        </span>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-overlay/[0.06] px-4 py-3 space-y-3 bg-overlay/[0.02] text-xs">
          {/* 请求 */}
          <div>
            <div className="text-muted-foreground mb-1 font-medium">{t('history.request')}</div>
            <pre className="font-mono bg-overlay/[0.04] rounded-lg p-2.5 whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">
              {method} {entry.request_url}
            </pre>
          </div>

          {/* 响应 */}
          {entry.response_body && (
            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <span className="font-medium">{t('history.response')}</span>
                {entry.response_size > 0 && (
                  <span className="text-muted-foreground/50">{formatSize(entry.response_size)}</span>
                )}
              </div>
              <pre className="font-mono bg-overlay/[0.04] rounded-lg p-2.5 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                {tryPrettyJson(entry.response_body)}
              </pre>
            </div>
          )}

          {/* 断言结果 */}
          {assertions.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1 font-medium">{t('history.assertions')}</div>
              <div className="space-y-0.5">
                {assertions.map((a) => (
                  <div key={a.assertion_id} className="flex items-center gap-1.5">
                    {a.passed
                      ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                      : <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                    }
                    <span className={a.passed ? '' : 'text-red-500'}>{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {entry.error_message && (
            <div className="text-red-500 bg-red-500/5 rounded-lg p-2.5">{entry.error_message}</div>
          )}

          {/* 操作栏 */}
          <div className="flex items-center gap-2 pt-1">
            {entry.item_id && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onGoTo() }}>
                <ExternalLink className="h-3 w-3" />
                {t('history.go_to_request')}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete() }}>
              <Trash2 className="h-3 w-3" />
              {t('common.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function tryPrettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}
