import { useTranslation } from 'react-i18next'
import { Play, Square, Plus, Link2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { TestProgress, ExecutionResult, BatchResult } from '@/types'
import type { FlatReq } from './collection-overview-model'

interface ToolbarProps {
  running: boolean
  dryRun: boolean
  onRunAll: () => void
  onStop: () => void
  onAddCase: () => void
  onAddChain: () => void
  onExportHtml: () => void
  hasBatchResult: boolean
}

/** 顶部操作栏：运行/停止/新增/导出 */
export function CollectionOverviewToolbar({
  running, dryRun, onRunAll, onStop, onAddCase, onAddChain, onExportHtml, hasBatchResult,
}: ToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 flex-1">
        {running ? (
          <Button onClick={onStop} size="sm" variant="destructive" className="gap-1.5">
            <Square className="h-3 w-3" /> {t('dashboard.stop')}
          </Button>
        ) : (
          <Button onClick={onRunAll} size="sm" className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> {dryRun ? t('dashboard.dry_run') : t('dashboard.run_all')}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onAddCase}>
          <Plus className="h-3.5 w-3.5" /> {t('dashboard.add_case')}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onAddChain}>
          <Link2 className="h-3.5 w-3.5" /> {t('dashboard.add_chain')}
        </Button>
        {hasBatchResult && (
          <Button variant="outline" size="sm" onClick={onExportHtml} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> {t('dashboard.export_report')}
          </Button>
        )}
      </div>
    </div>
  )
}

interface ProgressProps {
  running: boolean
  progress: TestProgress[]
  singleResults: Record<string, ExecutionResult>
  total: number
  progressPercent: number
  allRequests: FlatReq[]
  error: string | null
  batchResult: BatchResult | null
}

/** 运行进度条 + 错误提示 */
export function CollectionOverviewProgress({
  running, progress, singleResults, total, progressPercent, allRequests, error,
}: ProgressProps) {
  const { t } = useTranslation()
  return (
    <>
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
    </>
  )
}
