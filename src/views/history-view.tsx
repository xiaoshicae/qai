import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Clock, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { useNavigate } from 'react-router-dom'
import { useCollectionStore } from '@/stores/collection-store'
import type { CollectionItem, ExecutionResult } from '@/types'
import { ViewLoader } from '@/components/ui/view-loader'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { toast } from 'sonner'
import type { HistoryEntry, HistoryStats } from '@/types'
import { HistoryRow } from './history-row'

const PAGE_SIZE = 50

const STATUS_FILTERS = ['all', 'success', 'failed', 'error'] as const
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']

export default function HistoryView() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { selectNode, loadTree } = useCollectionStore()
  const confirmFn = useConfirmStore((s) => s.confirm)

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState<HistoryStats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)

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
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
    setLoaded(true)
  }, [statusFilter, methodFilter, debouncedKeyword])

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<HistoryStats>('history_stats')
      setStats(s)
    } catch (e) {
      toast.error(invokeErrorMessage(e))
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

  useEffect(() => {
    if (!highlightEntryId) return
    const tmr = window.setTimeout(() => setHighlightEntryId(null), 2600)
    return () => window.clearTimeout(tmr)
  }, [highlightEntryId])

  const loadMore = () => fetchEntries(entries.length, true)

  const handleGoToRequest = async (entry: HistoryEntry) => {
    if (!entry.item_id) return
    try {
      const item = await invoke<CollectionItem>('get_item', { id: entry.item_id })
      sessionStorage.setItem('qai.openEditDebug', JSON.stringify({ itemId: entry.item_id, collectionId: item.collection_id }))
      await loadTree(item.collection_id)
      selectNode(entry.item_id)
      navigate('/')
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirmFn(t('history.confirm_delete'), { title: t('common.delete'), kind: 'warning' })
    if (!ok) return
    try {
      await invoke('delete_history', { id })
      setEntries((prev) => prev.filter((e) => e.id !== id))
      await fetchStats()
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }

  const handleRunAgain = async (entry: HistoryEntry) => {
    if (!entry.item_id) return
    try {
      const result = await invoke<ExecutionResult>('send_request', { id: entry.item_id })
      toast.success(t('history.run_again_done'))
      setHighlightEntryId(result.execution_id)
      await fetchEntries(0, false)
      await fetchStats()
      listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }

  const handleClearAll = async () => {
    const ok = await confirmFn(t('history.confirm_clear'), { title: t('history.clear_all'), kind: 'warning' })
    if (!ok) return
    try {
      await invoke('clear_history')
      setEntries([])
      setHasMore(false)
      setStats({ total: 0, success_count: 0, failed_count: 0, error_count: 0, avg_time_ms: 0 })
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }

  const formatTime = (s: string) => {
    try {
      const d = new Date(s.replace(' ', 'T'))
      const now = Date.now()
      const diff = now - d.getTime()
      if (diff < 0 || isNaN(diff)) return '-'
      if (diff < 60000) return t('history.just_now')
      if (diff < 3600000) return t('history.minutes_ago', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return t('history.hours_ago', { n: Math.floor(diff / 3600000) })
      if (diff < 604800000) return t('history.days_ago', { n: Math.floor(diff / 86400000) })
      const locale = i18n.language === 'zh' ? 'zh-CN' : 'en-US'
      return d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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

  if (!loaded) return <ViewLoader />

  return (
    <div ref={listScrollRef} className="mx-auto max-w-4xl px-6 py-6 h-full overflow-y-auto">
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
              highlight={highlightEntryId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onGoTo={() => handleGoToRequest(entry)}
              onRunAgain={() => handleRunAgain(entry)}
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
