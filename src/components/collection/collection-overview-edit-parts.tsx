import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Download, Copy, CheckCircle2, XCircle, Plus, Trash2, Pencil, Loader2, Bug, Braces, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CodeEditor } from '@/components/ui/code-editor'
import KeyValueTable from '@/components/request/key-value-table'
import { VarInput } from '@/components/ui/var-input'
import type { CollectionItem, ExecutionResult } from '@/types'
import { BodyTypeSelector } from '@/components/request/body-type-selector'
import { WsStepsEditor } from '@/components/request/ws-steps-editor'
import { MiniResponseViewer } from '@/components/request/mini-response-viewer'
import AssertionEditor from '@/components/assertion/assertion-editor'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { METHOD_COLORS } from '@/lib/styles'

type EditFormTab = 'body' | 'headers' | 'assertions' | 'extract' | 'poll'

import { METHOD_OPTIONS, EXTRACT_SOURCE_OPTIONS } from '@/lib/constants'

export function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-overlay/[0.06] px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${color ?? ''}`}>{value}</div>
    </div>
  )
}

export function InlineEdit({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const { t } = useTranslation()
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
      title={t('edit.double_click_edit')}
    >
      {value || <span className="text-muted-foreground/40 italic">{placeholder}</span>}
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditing(true) }} />
    </span>
  )
}

function ExtractRulesEditor({ value, onChange }: {
  value: { var_name: string; source: string; expression: string }[]
  onChange: (rules: { var_name: string; source: string; expression: string }[]) => void
}) {
  const { t } = useTranslation()
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
          <Input value={rule.var_name} onChange={(e) => updateRule(i, 'var_name', e.target.value)} className="h-7 text-xs flex-1" placeholder={t('edit.var_name_placeholder')} />
          <Select value={rule.source} onChange={(v) => updateRule(i, 'source', v)} options={EXTRACT_SOURCE_OPTIONS} className="w-32" />
          <Input value={rule.expression} onChange={(e) => updateRule(i, 'expression', e.target.value)} className="h-7 text-xs flex-1" placeholder={t('edit.expression_placeholder')} />
          <button type="button" onClick={() => removeRule(i)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 cursor-pointer transition-colors shrink-0">
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRule} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
        <Plus className="h-3 w-3" /> {t('edit.add_extract')}
      </button>
      {value.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60">{t('common.extract_hint')}</p>
      )}
    </div>
  )
}

function PollConfigEditor({ value, onChange }: {
  value: { field: string; target: string; interval_seconds: number; max_seconds: number } | null
  onChange: (cfg: { field: string; target: string; interval_seconds: number; max_seconds: number } | null) => void
}) {
  const { t } = useTranslation()
  const defaults = { field: '', target: '', interval_seconds: 5, max_seconds: 60 }
  const [localConfig, setLocalConfig] = useState(value ?? defaults)
  const [enabled, setEnabled] = useState(value !== null)

  // 外部 value 变化时同步本地（如初始加载）
  useEffect(() => {
    if (value) { setLocalConfig(value); setEnabled(true) }
  }, [value])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    onChange(next ? localConfig : null)
  }

  const update = (field: string, val: string | number) => {
    const updated = { ...localConfig, [field]: val }
    setLocalConfig(updated)
    if (enabled) onChange(updated)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-xs text-muted-foreground">{t('edit.poll_label')}</label>
        <button
          type="button"
          onClick={toggle}
          className={`px-2 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${enabled ? 'bg-warning/15 text-warning' : 'bg-overlay/[0.04] text-muted-foreground hover:text-foreground'}`}
        >
          {enabled ? t('assertion.enabled') : t('assertion.disabled')}
        </button>
      </div>
      {enabled && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-overlay/[0.06] bg-overlay/[0.02]">
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">{t('edit.poll_field')}</label>
            <Input value={localConfig.field} onChange={(e) => update('field', e.target.value)} className="h-7 text-xs" placeholder={t('edit.field_placeholder')} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">{t('edit.poll_target')}</label>
            <Input value={localConfig.target} onChange={(e) => update('target', e.target.value)} className="h-7 text-xs" placeholder={t('edit.target_placeholder')} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">{t('edit.poll_interval')}</label>
            <Input type="number" value={localConfig.interval_seconds} onChange={(e) => update('interval_seconds', Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">{t('edit.poll_max')}</label>
            <Input type="number" value={localConfig.max_seconds} onChange={(e) => update('max_seconds', Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <p className="col-span-2 text-[10px] text-muted-foreground/60">
            {t('edit.poll_desc', { interval: localConfig.interval_seconds, field: localConfig.field, target: localConfig.target, max: localConfig.max_seconds })}
          </p>
        </div>
      )}
    </div>
  )
}

interface ParseCurlResult {
  method?: string
  url?: string
  headers?: unknown
  body_type?: string
  body_content?: string
}

export function EditForm({ req, onChange, onSave, onEnsureSaved, onCancel, envVars, saving }: {
  req: CollectionItem
  onChange: (r: CollectionItem) => void
  onSave: () => void
  onEnsureSaved?: () => Promise<string | null>
  onCancel: () => void
  envVars: Record<string, string>
  saving?: boolean
}) {
  const { t } = useTranslation()
  const set = (field: keyof CollectionItem, value: string | number) => onChange({ ...req, [field]: value })
  const [activeTab, setActiveTab] = useState<EditFormTab>('body')
  const [showCurlImport, setShowCurlImport] = useState(false)
  const [curlInput, setCurlInput] = useState('')
  const [curlCopied, setCurlCopied] = useState(false)
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugResult, setDebugResult] = useState<ExecutionResult | null>(null)
  const [debugStreamContent, setDebugStreamContent] = useState('')
  const [debugStreaming, setDebugStreaming] = useState(false)
  const streamContentRef = useRef('')
  const streamScrollRef = useRef<HTMLPreElement>(null)
  const [touched, setTouched] = useState(false)
  const nameError = touched && !req.name.trim()
  const [assertionCount, setAssertionCount] = useState(0)
  const [autoSaving, setAutoSaving] = useState(false)

  useEffect(() => {
    if (!req.id) { setAssertionCount(0); return }
    invoke<{ id: string }[]>('list_assertions', { itemId: req.id }).then((list) => setAssertionCount(list.length)).catch(() => {})
  }, [req.id])

  useEffect(() => {
    setDebugResult(null)
    setDebugStreamContent('')
  }, [req.id])

  const importFromCurl = async () => {
    if (!curlInput.trim()) return
    try {
      const parsed = await invoke<ParseCurlResult>('parse_curl', { curlCommand: curlInput })
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
    } catch (e: unknown) {
      toast.error(`${t('edit.parse_failed')}: ${invokeErrorMessage(e)}`)
    }
  }

  const exportToCurl = async () => {
    try {
      const vars = envVars ?? {}
      const rv = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m)
      const hdrs: { key: string; value: string; enabled: boolean }[] = (() => { try { return JSON.parse(req.headers || '[]') } catch { return [] } })()
      const autoContentType = ['form-data', 'json', 'urlencoded', 'form'].includes(req.body_type)
      const parts = [`curl -X ${req.method}`, `  '${rv(req.url)}'`]
      for (const h of hdrs.filter((h) => h.enabled)) {
        if (autoContentType && h.key.toLowerCase() === 'content-type') continue
        parts.push(`  -H '${rv(h.key)}: ${rv(h.value)}'`)
      }
      if (req.body_type !== 'none' && req.body_content) {
        if (req.body_type === 'form-data') {
          const fields: { key: string; value: string; enabled: boolean; fieldType?: string }[] = (() => { try { return JSON.parse(req.body_content) } catch { return [] } })()
          for (const f of fields.filter((f) => f.enabled && f.key)) {
            if (f.fieldType === 'file') parts.push(`  -F '${rv(f.key)}=@${rv(f.value)}'`)
            else parts.push(`  -F '${rv(f.key)}=${rv(f.value)}'`)
          }
        } else if (req.body_type === 'urlencoded' || req.body_type === 'form') {
          const fields: { key: string; value: string; enabled: boolean }[] = (() => { try { return JSON.parse(req.body_content) } catch { return [] } })()
          const encoded = fields.filter((f) => f.enabled && f.key).map((f) => `${encodeURIComponent(rv(f.key))}=${encodeURIComponent(rv(f.value))}`).join('&')
          if (encoded) parts.push(`  -d '${encoded}'`)
        } else {
          parts.push(`  -d '${rv(req.body_content)}'`)
        }
      }
      const curl = parts.join(' \\\n')
      await navigator.clipboard.writeText(curl)
      setCurlCopied(true)
      setTimeout(() => setCurlCopied(false), 1500)
    } catch (e) {
      toast.error(invokeErrorMessage(e))
    }
  }

  const headers: { key: string; value: string; enabled: boolean }[] = (() => {
    try { const p = JSON.parse(req.headers || '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
  })()
  const setHeaders = (h: typeof headers) => set('headers', JSON.stringify(h))

  const extractRules = (() => { try { const p = JSON.parse(req.extract_rules || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
  const hasPollConfig = !!req.poll_config && req.poll_config !== '{}'

  const runDebug = async () => {
    if (!req.url?.trim()) return
    setDebugLoading(true)
    setDebugResult(null)
    setDebugStreamContent('')
    streamContentRef.current = ''

    const tempId = crypto.randomUUID()
    const payload = {
      method: req.method || 'GET',
      url: req.url,
      headers: req.headers || '[]',
      queryParams: req.query_params || '[]',
      bodyType: req.body_type || 'none',
      bodyContent: req.body_content || '',
      protocol: req.protocol || 'http',
      requestId: tempId,
    }

    // 始终监听 stream-chunk，后端自动检测 SSE 响应
    let unlisten: (() => void) | undefined
    let streamStarted = false
    try {
      unlisten = await listen<{ item_id: string; chunk: string; done: boolean }>('stream-chunk', (event) => {
        if (event.payload.item_id !== tempId) return
        if (event.payload.done || event.payload.chunk === '[DONE]') return
        if (!streamStarted) { streamStarted = true; setDebugStreaming(true) }
        streamContentRef.current += event.payload.chunk
        setDebugStreamContent(streamContentRef.current)
        requestAnimationFrame(() => {
          streamScrollRef.current?.scrollTo({ top: streamScrollRef.current.scrollHeight })
        })
      })
      const result = await invoke<ExecutionResult>('quick_test', { payload })
      setDebugResult(result)
      if (result.status !== 'success' && result.error_message) {
        toast.error(result.error_message)
      }
    } catch (e: unknown) {
      toast.error(invokeErrorMessage(e))
    } finally {
      unlisten?.()
      setDebugLoading(false)
      setDebugStreaming(false)
    }
  }

  // ⌘+Enter 发送调试请求
  const runDebugRef = useRef(runDebug)
  runDebugRef.current = runDebug
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        runDebugRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const tabDefs: { key: EditFormTab; label: string; count?: number }[] = [
    { key: 'body', label: t('edit.body') },
    { key: 'headers', label: 'Headers', count: headers.filter((h) => h.key).length },
    { key: 'assertions', label: t('edit.assertions_tab'), count: assertionCount || undefined },
    { key: 'extract', label: t('edit.extract_tab'), count: extractRules.length || undefined },
    { key: 'poll', label: t('edit.poll_config'), count: hasPollConfig ? 1 : undefined },
  ]
  // debug 不再作为页签，而是底部操作按钮

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('edit.name')}</label>
          <Input value={req.name} onChange={(e) => set('name', e.target.value)} onBlur={() => setTouched(true)} className="h-8 text-sm" error={nameError} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('edit.desc')}</label>
          <Input value={req.description} onChange={(e) => set('description', e.target.value)} className="h-8 text-sm" placeholder={t('edit.desc_placeholder')} />
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <Select value={req.method} onChange={(v) => set('method', v)} options={METHOD_OPTIONS} className={`w-28 ${METHOD_COLORS[req.method] ?? ''}`} />
        <VarInput value={req.url} onChange={(v) => set('url', v)} placeholder={t('edit.url_placeholder')} envVars={envVars} />
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowCurlImport(!showCurlImport)}
            className="h-8 px-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors flex items-center gap-1"
            title={t('edit.import_curl')}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="text-[10px]">cURL</span>
          </button>
          {req.id && req.url && (
            <button
              type="button"
              onClick={exportToCurl}
              className="h-8 px-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors flex items-center gap-1"
              title={t('edit.copy_curl')}
            >
              {curlCopied
                ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                : <Copy className="h-3.5 w-3.5" />}
              <span className="text-[10px]">{curlCopied ? 'Copied' : 'cURL'}</span>
            </button>
          )}
        </div>
      </div>

      {showCurlImport && (
        <div className="relative">
          <textarea
            value={curlInput}
            onChange={(e) => setCurlInput(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 py-2.5 pr-10 text-xs resize-y outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            placeholder={'curl -X POST https://api.example.com \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"key":"value"}\''}
            autoFocus
          />
          <button type="button" onClick={() => { setShowCurlImport(false); setCurlInput('') }} className="absolute top-2.5 right-2.5 text-muted-foreground/40 hover:text-foreground cursor-pointer transition-colors">
            <XCircle className="h-3.5 w-3.5" />
          </button>
          {curlInput.trim() && (
            <div className="absolute bottom-2.5 right-2.5">
              <Button size="sm" onClick={importFromCurl}>{t('edit.parse_import')}</Button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 border-b border-overlay/[0.06] flex-wrap">
        {tabDefs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`relative pb-2 text-xs font-medium cursor-pointer transition-colors ${activeTab === tab.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.count ? <span className="text-[10px] text-muted-foreground/60">({tab.count})</span> : null}
            </span>
            {activeTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'body' && (
          <div className="flex flex-col h-full">
            {req.protocol === 'websocket' ? (
              <WsStepsEditor
                value={req.body_content}
                onChange={(v) => set('body_content', v)}
                onBlur={() => {}}
                onSubmit={() => {}}
              />
            ) : (
              <>
                <div className="mb-2 shrink-0">
                  <BodyTypeSelector value={req.body_type} onChange={(v) => set('body_type', v)}>
                    {req.body_type === 'json' && req.body_content && (
                      <button
                        type="button"
                        className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors"
                        onClick={() => { try { set('body_content', JSON.stringify(JSON.parse(req.body_content), null, 2)) } catch { /* ignore */ } }}
                      >
                        <Braces className="h-3 w-3" /> Format
                      </button>
                    )}
                  </BodyTypeSelector>
                </div>
                {req.body_type === 'none' ? (
                  <div className="flex-1 min-h-[120px] rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] flex items-center justify-center">
                    <span className="text-xs text-muted-foreground/40">{t('scenario.no_body')}</span>
                  </div>
                ) : (req.body_type === 'form-data' || req.body_type === 'urlencoded' || req.body_type === 'form') ? (
                  <KeyValueTable
                    value={(() => { try { const p = JSON.parse(req.body_content || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()}
                    onChange={(v) => set('body_content', JSON.stringify(v))}
                    allowFiles={req.body_type === 'form-data'}
                    envVars={envVars}
                  />
                ) : (
                  <CodeEditor
                    value={req.body_content}
                    onChange={(v) => set('body_content', v)}
                    language={req.body_type === 'json' ? 'json' : 'plaintext'}
                    className="w-full flex-1 min-h-[160px]"
                    placeholder='{ "key": "value" }'
                  />
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'headers' && (
          <KeyValueTable
            value={headers}
            onChange={setHeaders}
            envVars={envVars}
          />
        )}

        {activeTab === 'assertions' && (
          req.id
            ? <AssertionEditor requestId={req.id} />
            : <div className="flex flex-col items-center gap-3 py-8">
                <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
                <span className="text-xs text-muted-foreground/50">{t('assertion.empty_hint')}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.12]"
                  disabled={autoSaving}
                  onClick={async () => {
                    if (!req.name.trim()) { setTouched(true); return }
                    if (!onEnsureSaved) return
                    setAutoSaving(true)
                    await onEnsureSaved()
                    setAutoSaving(false)
                  }}
                >
                  {autoSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Plus className="h-3 w-3 mr-1.5" />}
                  {t('assertion.add')}
                </Button>
              </div>
        )}

        {activeTab === 'extract' && (
          <ExtractRulesEditor
            value={extractRules}
            onChange={(rules) => set('extract_rules', JSON.stringify(rules))}
          />
        )}

        {activeTab === 'poll' && (
          <PollConfigEditor
            value={(() => { try { return req.poll_config ? JSON.parse(req.poll_config) : null } catch { return null } })()}
            onChange={(cfg) => set('poll_config', cfg ? JSON.stringify(cfg) : '')}
          />
        )}
      </div>

      {/* 流式输出 — fills remaining space */}
      {debugStreaming && debugStreamContent && (
        <div className="rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] overflow-hidden text-xs flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-overlay/[0.06] shrink-0">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-muted-foreground">Streaming...</span>
          </div>
          <pre ref={streamScrollRef} className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all flex-1 min-h-0 overflow-y-auto p-3">
            {debugStreamContent}<span className="animate-pulse text-primary">|</span>
          </pre>
        </div>
      )}

      {/* 调试结果 — fills remaining space, internal scroll only */}
      {debugResult && !debugStreaming && <MiniResponseViewer result={debugResult} className="flex-1 min-h-0" />}

      {/* 底部操作栏 */}
      <div className="flex items-center gap-2 pt-3 border-t border-overlay/[0.06] shrink-0">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => runDebug()} disabled={debugLoading || !req.url?.trim()}>
          {debugLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
          {t('edit.debug_send')}
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onCancel}>{t('edit.cancel')}</Button>
        <Button size="sm" onClick={() => { setTouched(true); if (req.name.trim()) onSave() }} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('edit.save')}
        </Button>
      </div>
    </div>
  )
}
