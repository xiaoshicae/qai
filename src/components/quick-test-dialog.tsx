import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Loader2, Play, ClipboardPaste, Braces, X, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { VarInput } from '@/components/ui/var-input'
import { CodeEditor } from '@/components/ui/code-editor'
import KeyValueTable from '@/components/request/key-value-table'
import { BodyTypeSelector } from '@/components/request/body-type-selector'
import { MiniResponseViewer } from '@/components/request/mini-response-viewer'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { useEnvVars } from '@/hooks/use-env-vars'
import { METHOD_COLORS } from '@/lib/styles'
import type { ExecutionResult, KeyValuePair } from '@/types'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map((m) => ({ value: m, label: m }))

type Tab = 'body' | 'headers'

interface ParseCurlResult {
  method?: string
  url?: string
  headers?: KeyValuePair[]
  body_type?: string
  body_content?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  envVars?: Record<string, string>
}

export default function QuickTestDialog({ open, onOpenChange, envVars: envVarsProp }: Props) {
  const { t } = useTranslation()
  const { envVars: activeEnvVars } = useEnvVars()
  const envVars = useMemo(() => envVarsProp ?? activeEnvVars, [envVarsProp, activeEnvVars])
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KeyValuePair[]>([])
  const [bodyType, setBodyType] = useState('none')
  const [bodyContent, setBodyContent] = useState('')
  const [bodyKv, setBodyKv] = useState<KeyValuePair[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const streamContentRef = useRef('')
  const streamScrollRef = useRef<HTMLPreElement>(null)
  const [curlInput, setCurlInput] = useState('')
  const [curlCollapsed, setCurlCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('body')

  const send = useCallback(async () => {
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    setStreamContent('')
    streamContentRef.current = ''

    const isKvBody = bodyType === 'form-data' || bodyType === 'urlencoded'
    const tempId = crypto.randomUUID()
    let unlisten: (() => void) | undefined
    let streamStarted = false
    try {
      unlisten = await listen<{ item_id: string; chunk: string; done: boolean }>('stream-chunk', (event) => {
        if (event.payload.item_id !== tempId) return
        if (event.payload.done || event.payload.chunk === '[DONE]') return
        if (!streamStarted) { streamStarted = true; setStreaming(true) }
        streamContentRef.current += event.payload.chunk
        setStreamContent(streamContentRef.current)
        requestAnimationFrame(() => {
          streamScrollRef.current?.scrollTo({ top: streamScrollRef.current.scrollHeight })
        })
      })
      const res = await invoke<ExecutionResult>('quick_test', {
        payload: {
          method,
          url,
          headers: JSON.stringify(headers),
          queryParams: '[]',
          bodyType,
          bodyContent: isKvBody ? JSON.stringify(bodyKv) : bodyContent,
          protocol: 'http',
          requestId: tempId,
        },
      })
      setResult(res)
      if (res.status !== 'success' && res.error_message) {
        toast.error(res.error_message)
      }
    } catch (e: unknown) {
      toast.error(invokeErrorMessage(e))
    } finally {
      unlisten?.()
      setLoading(false)
      setStreaming(false)
    }
  }, [method, url, headers, bodyType, bodyContent, bodyKv])

  // ⌘+Enter 发送
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        sendRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const applyParsed = (parsed: ParseCurlResult) => {
    if (parsed.method) setMethod(parsed.method)
    if (parsed.url) setUrl(parsed.url)
    if (parsed.headers) setHeaders(parsed.headers)
    if (parsed.body_type && parsed.body_type !== 'none') {
      setBodyType(parsed.body_type)
      if (parsed.body_content) {
        if (parsed.body_type === 'form-data' || parsed.body_type === 'urlencoded') {
          try { setBodyKv(JSON.parse(parsed.body_content)) } catch { setBodyContent(parsed.body_content) }
        } else {
          setBodyContent(parsed.body_content)
        }
      }
    }
  }

  const importFromCurl = async (text?: string) => {
    const raw = text ?? curlInput
    if (!raw.trim()) return
    try {
      const parsed = await invoke<ParseCurlResult>('parse_curl', { curlCommand: raw })
      applyParsed(parsed)
      setCurlCollapsed(true)
      setCurlInput('')
    } catch (e: unknown) {
      toast.error(invokeErrorMessage(e))
    }
  }


  const activeHeaderCount = headers.filter((h) => h.key).length

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'body', label: t('edit.body') },
    { key: 'headers', label: 'Headers', count: activeHeaderCount },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
        <DialogClose onClose={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle>{t('quick_test.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
          {/* curl 粘贴区 */}
          {!curlCollapsed ? (
            <div className="rounded-xl border border-dashed border-overlay/[0.12] bg-overlay/[0.02] overflow-hidden shrink-0 relative">
              <button
                type="button"
                onClick={() => { setCurlCollapsed(true); setCurlInput('') }}
                className="absolute top-2 right-2 z-10 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="relative">
                <textarea
                  value={curlInput}
                  onChange={(e) => setCurlInput(e.target.value)}
                  rows={4}
                  className="w-full bg-transparent px-4 py-3 pr-10 text-xs resize-none outline-none placeholder:text-muted-foreground/30"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                  placeholder={'# ' + t('quick_test.paste_hint') + '\n\ncurl -X POST https://api.example.com \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"key":"value"}\''}
                  autoFocus
                />
                {!curlInput && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/20">
                      <ClipboardPaste className="h-8 w-8" />
                      <span className="text-xs font-medium">{t('quick_test.paste_curl')}</span>
                    </div>
                  </div>
                )}
              </div>
              {curlInput && (
                <div className="flex items-center justify-end px-4 py-2 border-t border-overlay/[0.06]">
                  <Button size="sm" onClick={() => importFromCurl()} disabled={!curlInput.trim()}>
                    {t('edit.parse_import')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              onClick={() => setCurlCollapsed(false)}
            >
              <ClipboardPaste className="h-3 w-3" />
              {t('quick_test.reimport_curl')}
            </button>
          )}

          {/* Method + URL + Send */}
          <div className="flex gap-2 items-center">
            <Select value={method} onChange={setMethod} options={HTTP_METHODS} className={`w-28 ${METHOD_COLORS[method] ?? ''}`} />
            <VarInput value={url} onChange={setUrl} placeholder={t('quick_test.url_placeholder')} envVars={envVars} className="flex-1 h-9 font-mono text-xs" />
            <Button size="sm" className="gap-1.5 shrink-0" onClick={send} disabled={loading || !url.trim()}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t('quick_test.send')}
            </Button>
            {result && (
              <button
                type="button"
                onClick={() => { setResult(null); setStreamContent('') }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors shrink-0"
                title={t('quick_test.clear_result')}
                aria-label={t('quick_test.clear_result')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            {!result && url && (
              <button
                type="button"
                onClick={() => { setMethod('GET'); setUrl(''); setHeaders([]); setBodyType('none'); setBodyContent(''); setBodyKv([]); setResult(null); setStreamContent(''); setCurlCollapsed(false); setCurlInput('') }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors shrink-0"
                title={t('common.clear')}
                aria-label={t('common.clear')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Tabs: Body / Headers */}
          <div className="flex items-center gap-4 border-b border-overlay/[0.06]">
            {tabs.map((tab) => (
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

          {/* Tab content */}
          <div className="shrink-0">
            {activeTab === 'body' && (
              <div>
                <div className="mb-2">
                  <BodyTypeSelector value={bodyType} onChange={setBodyType}>
                    {bodyType === 'json' && bodyContent && (
                      <button
                        type="button"
                        className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors"
                        onClick={() => { try { setBodyContent(JSON.stringify(JSON.parse(bodyContent), null, 2)) } catch { /* ignore */ } }}
                      >
                        <Braces className="h-3 w-3" /> Format
                      </button>
                    )}
                  </BodyTypeSelector>
                </div>
                <div className="relative h-[180px]">
                  {bodyType === 'none' ? (
                    <div className="w-full h-full rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] flex items-center justify-center">
                      <span className="text-xs text-muted-foreground/40">{t('scenario.no_body')}</span>
                    </div>
                  ) : (bodyType === 'form-data' || bodyType === 'urlencoded') ? (
                    <div className="h-full overflow-y-auto">
                      <KeyValueTable value={bodyKv} onChange={setBodyKv} envVars={envVars} allowFiles={bodyType === 'form-data'} />
                    </div>
                  ) : (
                    <CodeEditor
                      value={bodyContent}
                      onChange={setBodyContent}
                      language={bodyType === 'json' ? 'json' : 'plaintext'}
                      className="w-full h-full"
                      placeholder='{ "key": "value" }'
                    />
                  )}
                </div>
              </div>
            )}

            {activeTab === 'headers' && (
              <KeyValueTable value={headers} onChange={setHeaders} envVars={envVars} />
            )}
          </div>

          {/* Streaming output — fills remaining space */}
          {streaming && streamContent && (
            <div className="rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] overflow-hidden text-xs flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-overlay/[0.06] shrink-0">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-muted-foreground">Streaming...</span>
              </div>
              <pre ref={streamScrollRef} className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all flex-1 min-h-0 overflow-y-auto p-3">
                {streamContent}<span className="animate-pulse text-primary">|</span>
              </pre>
            </div>
          )}

          {/* Result — fills remaining space, internal scroll only */}
          {result && !streaming && (
            <MiniResponseViewer result={result} className="flex-1 min-h-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
