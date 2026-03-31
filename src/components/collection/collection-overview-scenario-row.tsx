import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import {
  Play, Trash2, Pencil, Copy, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, AlertCircle, Circle, XCircle as XCircleIcon, GripVertical,
} from 'lucide-react'
import { JsonHighlight } from '@/components/ui/json-highlight'
import { VarHighlight } from '@/components/ui/var-highlight'
import { formatDuration, formatSize } from '@/lib/formatters'
import { extractBase64Media, redactBase64Fields } from '@/lib/media'
import type {
  CollectionItem, ItemLastStatus, TestProgress, ExecutionResult, HttpResponse,
} from '@/types'
import { formatRelativeTime } from './collection-overview-helpers'

interface RunRecordRow {
  response_status?: number | null
  response_headers?: string
  response_body?: string | null
  response_time_ms?: number
  response_size?: number
  assertion_results?: string
  error_message?: string | null
}

function ResponseBody({ resp }: { resp: HttpResponse | null | undefined }) {
  const { t } = useTranslation()
  if (!resp) return <div className="px-3 py-6 text-center text-xs text-muted-foreground/40">{t('scenario.not_run')}</div>

  if (resp.body.startsWith('data:')) {
    const isImage = resp.body.startsWith('data:image/')
    const isAudio = resp.body.startsWith('data:audio/')
    const isVideo = resp.body.startsWith('data:video/')
    // 从 data URI 中提取 MIME type
    const mimeMatch = resp.body.match(/^data:([^;,]+)/)
    const mime = mimeMatch?.[1] ?? t('response.binary_file')
    const mediaPreview = (isImage || isAudio || isVideo) ? (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-center">
          {isImage && <img src={resp.body} alt="response" className="max-h-56 max-w-full object-contain rounded-lg" />}
          {isAudio && <audio controls className="w-full max-w-md" src={resp.body} />}
          {isVideo && <video controls className="max-h-56 max-w-full rounded-lg" src={resp.body} />}
        </div>
        <div className="text-[10px] text-muted-foreground/50 font-mono px-1 flex items-center gap-2">
          <span>{mime}</span>
          <span>·</span>
          <span>{formatSize(resp.size_bytes)}</span>
          <span>·</span>
          <span>base64</span>
        </div>
      </div>
    ) : null
    if (mediaPreview) return mediaPreview
  }

  const contentType = resp.headers.find((h: { key: string }) => h.key.toLowerCase() === 'content-type')?.value?.toLowerCase() || ''
  if (contentType.includes('text/html')) {
    return (
      <div className="max-h-52 overflow-y-auto">
        <iframe srcDoc={resp.body} className="w-full h-52 border-0" sandbox="" title="HTML Preview" />
      </div>
    )
  }

  let parsed: unknown = null
  try { parsed = JSON.parse(resp.body) } catch { /* not JSON */ }

  if (parsed) {
    const mediaFields = extractBase64Media(parsed)
    if (mediaFields.length > 0) {
      const redacted = redactBase64Fields(parsed, mediaFields)
      return (
        <div className="max-h-64 overflow-y-auto">
          <div className="px-3 pt-2.5 space-y-2">
            {mediaFields.map((m, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] p-2.5 overflow-hidden">
                {m.type === 'image' && <img src={m.dataUrl} alt={m.path} className="max-h-28 max-w-[180px] object-contain rounded-lg flex-shrink-0" />}
                {m.type === 'audio' && <audio controls src={m.dataUrl} className="w-full max-w-xs flex-shrink-0" />}
                {m.type === 'video' && <video controls src={m.dataUrl} className="max-h-28 max-w-[180px] rounded-lg flex-shrink-0" />}
                <div className="text-xs text-muted-foreground min-w-0">
                  <div className="font-mono truncate">{m.path}</div>
                  <div className="mt-0.5">{formatSize(m.sizeBytes)}</div>
                </div>
              </div>
            ))}
          </div>
          <JsonHighlight code={JSON.stringify(redacted, null, 2)} className="px-3 py-2.5" />
        </div>
      )
    }
    return <JsonHighlight code={JSON.stringify(parsed, null, 2)} className="px-3 py-2.5 max-h-52 overflow-y-auto" />
  }

  return <JsonHighlight code={resp.body} className="px-3 py-2.5 max-h-52 overflow-y-auto" />
}

function FilePreviewThumb({ path }: { path: string }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
  const isAudio = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'webm'].includes(ext)
  const isVideo = ['mp4', 'mov'].includes(ext)
  const isPreviewable = isImage || isAudio || isVideo

  useEffect(() => {
    if (!isPreviewable || !path) return
    let cancelled = false
    invoke<string | null>('read_file_preview', { path }).then((dataUri) => {
      if (!cancelled && dataUri) setSrc(dataUri)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [path, isPreviewable])

  if (!isPreviewable || !src) return null
  const fileName = path.split('/').pop() || path

  if (isImage) return (
    <>
      <img src={src} alt="" className="h-7 w-7 rounded object-cover border border-overlay/[0.1] shrink-0 ml-auto cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all" onClick={() => setOpen(true)} />
      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}><img src={src} alt="" className="max-w-[80vw] max-h-[80vh] rounded-xl shadow-2xl" /></div>}
    </>
  )

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-overlay/[0.06] hover:bg-overlay/[0.1] text-muted-foreground hover:text-foreground text-[10px] font-medium cursor-pointer transition-colors shrink-0 ml-auto">
        <Play className="h-2.5 w-2.5" fill="currentColor" /> {t('scenario.preview')}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl p-5 shadow-2xl min-w-[340px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-foreground">{fileName}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground cursor-pointer"><XCircleIcon className="h-4 w-4" /></button>
            </div>
            {isAudio && <audio controls src={src} className="w-full" autoPlay />}
            {isVideo && <video controls src={src} className="w-full rounded-lg" autoPlay />}
          </div>
        </div>
      )}
    </>
  )
}

export function ScenarioRow({ r, stepLabel, indent, envVars = {}, getResult, getStatus: _getStatus, statuses, progress, runningIds, expandedRows, detailData, loadDetail, toggleRow, runSingle, openEdit, copyRequest, deleteRequest, streamingContent, canRun = true, version, enabled = true, onToggleEnabled, dragHandleProps }: {
  r: { id: string; name: string; method: string; folder?: string; expect_status?: number }
  stepLabel?: string
  indent?: boolean
  envVars?: Record<string, string>
  streamingContent?: string
  canRun?: boolean
  version?: number
  enabled?: boolean
  onToggleEnabled?: (id: string) => void
  dragHandleProps?: Record<string, unknown>
  getResult: (id: string) => ExecutionResult | undefined
  getStatus: (id: string) => string | undefined
  statuses: Record<string, ItemLastStatus>
  progress: TestProgress[]
  runningIds: Set<string>
  expandedRows: Set<string>
  detailData: Record<string, CollectionItem>
  loadDetail: (id: string) => void
  toggleRow: (id: string) => void
  runSingle: (id: string) => void
  openEdit: (id: string) => void
  copyRequest?: (id: string) => void
  deleteRequest: (id: string, name: string, e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const [reqTab, setReqTab] = useState<'body' | 'headers'>('body')
  const streamScrollRef = useRef<HTMLDivElement>(null)
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body')
  const result = getResult(r.id)
  const prog = progress.find((p) => p.item_id === r.id)
  const old = statuses[r.id]
  const expanded = expandedRows.has(r.id)
  const isRunning = runningIds.has(r.id) || prog?.status === 'running'
  const status = isRunning ? 'running' : (result?.status ?? prog?.status ?? old?.status)
  const detail = detailData[r.id]

  const [lastRun, setLastRun] = useState<{
    resp: HttpResponse
    assertions: { passed: boolean; actual: string; message: string }[]
    error?: string
  } | null>(null)

  // 编辑保存后 version 变化，清除旧执行数据并阻止重新加载
  const skipLoadRef = useRef(false)
  useEffect(() => {
    if (version) {
      setLastRun(null)
      skipLoadRef.current = true
    }
  }, [version])

  useEffect(() => {
    if (!expanded || result || skipLoadRef.current) {
      skipLoadRef.current = false
      return
    }
    invoke<RunRecordRow[]>('list_item_runs', { itemId: r.id, limit: 1 }).then((runs) => {
      if (runs.length > 0) {
        const run = runs[0]
        let headers: { key: string; value: string; enabled: boolean }[] = []
        try {
          const raw = JSON.parse(run.response_headers || '[]') as unknown
          if (Array.isArray(raw)) {
            headers = raw.map((h: unknown) => {
              const o = h as { key?: string; value?: string }
              return { key: o.key ?? '', value: o.value ?? '', enabled: true }
            })
          }
        } catch { /* ignore */ }
        let assertions: { passed: boolean; actual: string; message: string }[] = []
        try { assertions = JSON.parse(run.assertion_results || '[]') } catch { /* ignore */ }
        setLastRun({
          resp: { status: run.response_status ?? 0, status_text: '', headers, body: run.response_body ?? '', time_ms: run.response_time_ms ?? 0, size_bytes: run.response_size ?? 0 },
          assertions,
          error: run.error_message || undefined,
        })
      }
    }).catch(() => {})
  }, [expanded, result, r.id])

  const resp = isRunning ? null : result ? (result.response ?? null) : (lastRun?.resp ?? null)
  const displayAssertions = isRunning ? [] : result ? result.assertion_results : (lastRun?.assertions ?? [])
  const displayError = isRunning ? null : result ? result.error_message : (lastRun?.error ?? null)

  const chainVars = useMemo(() => {
    if (!indent || !detail) return undefined
    const vars = new Set<string>()
    const text = (detail.url || '') + (detail.body_content || '')
    for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) {
      if (!(m[1] in envVars)) vars.add(m[1])
    }
    return vars.size > 0 ? vars : undefined
  }, [indent, detail, envVars])

  useEffect(() => {
    if (expanded && !detail) loadDetail(r.id)
  }, [expanded, detail, r.id, loadDetail])

  useEffect(() => {
    if (streamingContent && streamScrollRef.current) {
      streamScrollRef.current.scrollTop = streamScrollRef.current.scrollHeight
    }
  }, [streamingContent])

  const sd = !status ? { icon: <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />, label: '-', color: '' }
    : status === 'running' ? { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />, label: 'Running', color: 'text-blue-500' }
    : status === 'success' ? { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'PASS', color: 'text-emerald-500' }
    : status === 'failed' ? { icon: <XCircle className="h-3.5 w-3.5" />, label: 'FAIL', color: 'text-red-500' }
    : { icon: <AlertCircle className="h-3.5 w-3.5" />, label: 'ERR', color: 'text-amber-500' }

  const enabledHeaderCount = detail
    ? (() => {
        try {
          const arr = JSON.parse(detail.headers) as { enabled?: boolean }[]
          return Array.isArray(arr) ? arr.filter((h) => h.enabled).length : 0
        } catch { return 0 }
      })()
    : 0

  return (
    <div>
      <div className={`grid grid-cols-[minmax(0,1fr)_80px_64px_64px_80px_72px] gap-2 px-4 py-3 text-sm hover:bg-overlay/[0.03] cursor-pointer transition-colors group ${indent ? 'pl-10 bg-overlay/[0.02]' : ''} ${!enabled ? 'opacity-40' : ''}`} onClick={() => toggleRow(r.id)}>
        <span className="flex items-center gap-1.5 min-w-0">
          {dragHandleProps && !indent && (
            <span {...dragHandleProps} className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity shrink-0 touch-none" onClick={(e) => e.stopPropagation()}>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          {onToggleEnabled && !indent && (
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => { e.stopPropagation(); onToggleEnabled(r.id) }}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0 mr-1"
            />
          )}
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {stepLabel && <span className="text-[10px] text-amber-500/70 font-mono shrink-0">{stepLabel}</span>}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${r.method === 'GET' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : r.method === 'POST' ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10' : r.method === 'PUT' ? 'text-sky-600 dark:text-sky-400 bg-sky-500/10' : r.method === 'DELETE' ? 'text-red-600 dark:text-red-400 bg-red-500/10' : 'text-purple-600 dark:text-purple-400 bg-purple-500/10'}`}>{r.method}</span>
          <span className="font-medium truncate">{r.name}</span>
        </span>
        <span className={`flex items-center gap-1 font-bold text-xs ${sd.color}`}>{sd.icon}{sd.label}</span>
        <span className="font-mono text-xs self-center tabular-nums">
          {resp
            ? <span className={resp.status < 300 ? 'text-emerald-500' : resp.status < 400 ? 'text-amber-500' : 'text-red-500'}>{resp.status}</span>
            : <span className="text-muted-foreground">{r.expect_status || 200}</span>}
        </span>
        <span className="text-xs text-muted-foreground self-center tabular-nums">{resp ? formatDuration(resp.time_ms) : old ? formatDuration(old.response_time_ms) : '-'}</span>
        <span className="text-[10px] text-muted-foreground/60 self-center tabular-nums">{old?.executed_at ? formatRelativeTime(old.executed_at, t) : '-'}</span>
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`h-6 w-6 flex items-center justify-center rounded-md transition-all cursor-pointer ${!canRun ? 'opacity-20 cursor-not-allowed' : 'opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-overlay/[0.06]'}`} onClick={() => canRun && runSingle(r.id)} disabled={isRunning || !canRun} title={!canRun ? t('chain.prev_step_required') : t('common.run')}>
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : <Play className="h-3 w-3 text-muted-foreground" />}
          </button>
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-overlay/[0.06] transition-all cursor-pointer" onClick={() => openEdit(r.id)} title={t('common.edit')}>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          {copyRequest && (
            <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-overlay/[0.06] transition-all cursor-pointer" onClick={() => copyRequest(r.id)} title={t('common.copy')}>
              <Copy className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
          <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-destructive/10 transition-all cursor-pointer" onClick={(e) => deleteRequest(r.id, r.name, e)} title={t('common.delete')}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className={`bg-overlay/[0.03] px-4 py-4 space-y-4 border-t border-overlay/[0.04] ${indent ? 'ml-6' : ''}`}>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              <div className="flex items-center justify-between border-b border-overlay/[0.04] px-3">
                <div className="flex items-center gap-0">
                  <button type="button" className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${reqTab === 'body' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setReqTab('body')}>
                    Body
                    {reqTab === 'body' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                  <button type="button" className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${reqTab === 'headers' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setReqTab('headers')}>
                    Headers{detail ? ` (${enabledHeaderCount})` : ''}
                    {reqTab === 'headers' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                </div>
              </div>
              <div className="px-3 py-2.5 max-h-52 overflow-y-auto">
                {!detail ? <span className="text-xs text-muted-foreground">{t('scenario.loading')}</span> : reqTab === 'body' ? (
                  <>
                    <div className="text-xs font-mono mb-2 flex items-baseline gap-2 flex-wrap">
                      <span><span className="text-method-post font-bold">{detail.method}</span>{' '}<VarHighlight text={detail.url} vars={envVars} chainVars={chainVars} className="text-xs font-mono" /></span>
                      {detail.body_type !== 'none' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-overlay/[0.06] text-muted-foreground/60 uppercase tracking-wider shrink-0">{detail.body_type === 'form' ? 'urlencoded' : detail.body_type}</span>}
                    </div>
                    {detail.body_type !== 'none' && detail.body_content && (
                      (detail.body_type === 'form-data' || detail.body_type === 'urlencoded' || detail.body_type === 'form') ? (() => {
                        let pairs: { key: string; value: string; enabled?: boolean; fieldType?: string }[] = []
                        try { const p = JSON.parse(detail.body_content); if (Array.isArray(p)) pairs = p } catch { /* ignore */ }
                        const active = pairs.filter((p) => p.enabled !== false)
                        const fileName = (path: string) => path.split('/').pop() || path.split('\\').pop() || path
                        return active.length > 0 ? (
                          <table className="w-full text-[11px]">
                            <thead><tr className="border-b border-overlay/[0.04]"><th className="text-left pr-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-1/3">Key</th><th className="text-left py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Value</th></tr></thead>
                            <tbody className="font-mono">{active.map((p, i) => (<tr key={i} className="border-b border-overlay/[0.02]">
                              <td className="pr-3 py-1 text-sky-600 dark:text-sky-400">{p.key}</td>
                              <td className="py-1 break-all">{p.fieldType === 'file' ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold uppercase shrink-0">file</span>
                                  <span className="text-foreground/70 truncate">{fileName(p.value)}</span>
                                  <FilePreviewThumb path={p.value} />
                                </div>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400">{p.value}</span>
                              )}</td>
                            </tr>))}</tbody>
                          </table>
                        ) : <span className="text-xs text-muted-foreground">{t('scenario.no_form_fields')}</span>
                      })() : <JsonHighlight code={(() => { try { return JSON.stringify(JSON.parse(detail.body_content), null, 2) } catch { return detail.body_content } })()} />
                    )}
                    {detail.body_type === 'none' && <span className="text-xs text-muted-foreground/40">{t('scenario.no_body')}</span>}
                  </>
                ) : (
                  (() => {
                    let hdrs: { key: string; value: string; enabled: boolean }[] = []
                    try { hdrs = JSON.parse(detail.headers) } catch { /* ignore */ }
                    const active = hdrs.filter((h) => h.enabled)
                    return active.length > 0 ? (
                      <table className="w-full text-[11px]">
                        <thead><tr className="border-b border-overlay/[0.04]"><th className="text-left pr-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-1/3">Key</th><th className="text-left py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Value</th></tr></thead>
                        <tbody className="font-mono">{active.map((h, i) => (
                          <tr key={i} className="border-b border-overlay/[0.02]">
                            <td className="pr-3 py-1 text-muted-foreground">{h.key}</td>
                            <td className="py-1 break-all"><VarHighlight text={h.value} vars={envVars} className="text-[11px] font-mono" /></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    ) : <span className="text-xs text-muted-foreground/40">{t('scenario.no_headers')}</span>
                  })()
                )}
              </div>
            </div>
            <div className="rounded-lg border border-overlay/[0.06] overflow-hidden">
              <div className="flex items-center justify-between border-b border-overlay/[0.04] px-3">
                <div className="flex items-center gap-0">
                  <button type="button" className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${respTab === 'body' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setRespTab('body')}>
                    Body
                    {respTab === 'body' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                  <button type="button" className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${respTab === 'headers' ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`} onClick={() => setRespTab('headers')}>
                    Headers{resp ? ` (${resp.headers.length})` : ''}
                    {respTab === 'headers' && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
                  </button>
                </div>
                {resp && (
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className={resp.status < 300 ? 'text-emerald-500 font-bold' : resp.status < 400 ? 'text-amber-500 font-bold' : 'text-red-500 font-bold'}>{resp.status} {resp.status_text}</span>
                    <span className="text-muted-foreground">{formatDuration(resp.time_ms)}</span>
                    <span className="text-muted-foreground">{resp.size_bytes > 1024 ? `${(resp.size_bytes / 1024).toFixed(1)}KB` : `${resp.size_bytes}B`}</span>
                  </div>
                )}
              </div>
              {respTab === 'body' ? (
                isRunning ? (
                  <div ref={streamScrollRef} className="px-3 py-2.5 max-h-52 overflow-y-auto">
                    {streamingContent ? (
                      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-foreground/80">
                        {streamingContent}<span className="animate-pulse text-primary">|</span>
                      </pre>
                    ) : (
                      <div className="flex items-center gap-2 py-6 justify-center">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">{t('scenario.waiting')}</span>
                      </div>
                    )}
                  </div>
                ) : <ResponseBody resp={resp} />
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
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground/40">{t('scenario.not_run')}</div>
                  )}
                </div>
              )}
              {displayAssertions.length > 0 && (
                <div className="border-t border-overlay/[0.04] px-3 py-1.5 flex items-center gap-3 flex-wrap">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">Assertions {displayAssertions.filter((a) => a.passed).length}/{displayAssertions.length}</span>
                  {displayAssertions.map((a, i) => (
                    <span key={i} className="flex items-center gap-1 text-[11px]">
                      {a.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                      <span className={a.passed ? 'text-muted-foreground' : 'text-red-400'}>{a.message}</span>
                      {!a.passed && a.actual && <span className="text-muted-foreground/60">(actual: {a.actual})</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {displayError && <div className="flex items-start gap-1.5 text-xs text-red-500"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{displayError}</div>}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground/80 pt-1">
            {detail?.created_at && <span>{t('scenario.created')}: {detail.created_at}</span>}
            {detail?.updated_at && <span>{t('scenario.updated')}: {detail.updated_at}</span>}
            {old?.executed_at && <span>{t('scenario.last_executed')}: {old.executed_at}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
