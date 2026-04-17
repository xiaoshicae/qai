import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GripVertical, Link2, Play, Loader2, Pencil, Plus, Copy, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScenarioRow } from './collection-overview-scenario-row'
import type { TestProgress, ExecutionResult, ItemLastStatus, CollectionItem } from '@/types'
import type { TableItem } from './collection-overview-model'

interface Props {
  /** chain group 在 tableItems 中对应的项 */
  group: Extract<TableItem, { isChain: true }>
  expandedKey: string
  expanded: boolean
  disabled: boolean
  onToggleExpanded: () => void
  onToggleDisabled: () => void
  editingChainId: string | null
  editingChainName: string
  onEditingChainNameChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartRename: (id: string, name: string, e: React.MouseEvent) => void
  onRunChain: (chainId: string, stepIds: string[]) => void
  onAddStep: (chainId: string) => void
  onCopy: (chainId: string) => void
  onDelete: (chainId: string, name: string, e: React.MouseEvent) => void
  /** chain 的 dragHandleProps（来自外层 SortableRow） */
  dragHandleProps: Record<string, unknown>
  /** ScenarioRow 共用 props */
  runningIds: Set<string>
  progress: TestProgress[]
  singleResultsKeys?: string[]
  itemVersion: Record<string, number>
  envVars: Record<string, string>
  assertionCounts: Record<string, number>
  getResult: (id: string) => ExecutionResult | undefined
  getStatus: (id: string) => string | undefined
  statuses: Record<string, ItemLastStatus>
  expandedRows: Set<string>
  detailData: Record<string, CollectionItem>
  loadDetail: (id: string) => Promise<void>
  toggleRow: (id: string) => void
  runSingle: (requestId: string) => void
  openEdit: (id: string) => void
  copyRequest: (id: string) => Promise<void>
  deleteRequest: (id: string, name: string, e: React.MouseEvent) => void
  streamingContents: Record<string, string>
}

/** Chain 分组行：折叠头 + 展开后的步骤行（透传给 ScenarioRow） */
export function ChainGroupRow(props: Props) {
  const { t } = useTranslation()
  const {
    group, expanded, disabled,
    onToggleExpanded, onToggleDisabled,
    editingChainId, editingChainName, onEditingChainNameChange,
    onCommitRename, onCancelRename, onStartRename,
    onRunChain, onAddStep, onCopy, onDelete,
    dragHandleProps,
    runningIds, progress, itemVersion, envVars, assertionCounts,
    getResult, getStatus, statuses, expandedRows, detailData,
    loadDetail, toggleRow, runSingle, openEdit, copyRequest, deleteRequest, streamingContents,
  } = props

  const isAnyStepRunning = runningIds.has(group.groupId) || group.steps.some(
    (s) => runningIds.has(s.id) || progress.find((p) => p.item_id === s.id)?.status === 'running'
  )
  const groupStatuses = group.steps.map((s) => getStatus(s.id)).filter(Boolean)
  const groupPass = groupStatuses.every((s) => s === 'success')
  const groupFail = groupStatuses.some((s) => s === 'failed' || s === 'error')
  const groupLabel = isAnyStepRunning ? 'Running' : groupStatuses.length === 0 ? '-' : groupPass ? 'PASS' : groupFail ? 'FAIL' : '-'
  const groupColor = isAnyStepRunning ? 'text-info' : groupStatuses.length === 0 ? '' : groupPass ? 'text-success' : groupFail ? 'text-error' : ''
  const isChainRunning = runningIds.has(group.groupId)

  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_80px_64px_64px_80px_72px] gap-2 px-4 py-2.5 text-sm bg-warning/5 hover:bg-warning/10 cursor-pointer transition-colors group"
        onClick={onToggleExpanded}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span {...dragHandleProps} className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity shrink-0 touch-none" onClick={(e) => e.stopPropagation()}>
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <input
            type="checkbox"
            checked={!disabled}
            onChange={onToggleDisabled}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0 mr-1"
          />
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-warning" /> : <ChevronRight className="h-3 w-3 shrink-0 text-warning" />}
          <Link2 className="h-3 w-3 shrink-0 text-warning" />
          {editingChainId === group.groupId ? (
            <Input
              value={editingChainName}
              onChange={(e) => onEditingChainNameChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') onCommitRename(); if (e.key === 'Escape') onCancelRename() }}
              className="h-6 text-sm font-medium w-48"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="font-medium truncate text-warning/90" onDoubleClick={(e) => onStartRename(group.groupId, group.groupName, e)}>{group.groupName}</span>
              <span className="text-[10px] text-warning/50 ml-1">{group.steps.length} {t('scenario.steps')}</span>
            </>
          )}
        </span>
        <span className={`flex items-center gap-1 font-bold text-xs ${groupColor}`}>{groupLabel}</span>
        <span className="font-mono text-xs self-center">-</span>
        <span />
        <span />
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => onRunChain(group.groupId, group.steps.map((s) => s.id))} disabled={isChainRunning} title={t('runner.run_chain')}>
            {isChainRunning ? <Loader2 className="h-3 w-3 animate-spin text-warning" /> : <Play className="h-3 w-3 text-warning" />}
          </button>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={(e) => onStartRename(group.groupId, group.groupName, e)} title={t('tree.rename')}>
            <Pencil className="h-3 w-3 text-warning" />
          </button>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => onAddStep(group.groupId)} title={t('chain.add_step')}>
            <Plus className="h-3 w-3 text-warning" />
          </button>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-overlay/[0.04] transition-all cursor-pointer" onClick={() => onCopy(group.groupId)} title={t('common.copy')}>
            <Copy className="h-3 w-3 text-warning" />
          </button>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => onDelete(group.groupId, group.groupName, e)} title={t('common.delete')}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </span>
      </div>
      {expanded && group.steps.map((r, stepIdx) => {
        const prevDone = stepIdx === 0 || !!getStatus(group.steps[stepIdx - 1].id)
        return (
          <ScenarioRow
            key={r.id}
            r={r}
            stepLabel={`Step ${stepIdx + 1}`}
            version={itemVersion[r.id]}
            indent
            envVars={envVars}
            assertionCount={assertionCounts[r.id] ?? 0}
            getResult={getResult}
            getStatus={getStatus}
            statuses={statuses}
            progress={progress}
            runningIds={runningIds}
            expandedRows={expandedRows}
            detailData={detailData}
            loadDetail={loadDetail}
            toggleRow={toggleRow}
            runSingle={runSingle}
            openEdit={openEdit}
            copyRequest={copyRequest}
            deleteRequest={deleteRequest}
            streamingContent={streamingContents[r.id]}
            canRun={prevDone}
          />
        )
      })}
    </div>
  )
}
