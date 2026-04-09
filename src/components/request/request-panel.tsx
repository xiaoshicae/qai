import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Loader2, Braces, Copy, Check, Plug, Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { CodeEditor } from '@/components/ui/code-editor'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import { useConfirmStore } from '@/components/ui/confirm-dialog'
import { useEnvVars } from '@/hooks/use-env-vars'
import KeyValueTable from './key-value-table'
import { BodyTypeSelector } from './body-type-selector'
import { WsStepsEditor } from './ws-steps-editor'
import AssertionEditor from '@/components/assertion/assertion-editor'
import ExtractRulesEditor from './extract-rules-editor'
import RunsTab from './runs-tab'
import type { KeyValuePair } from '@/types'
import { safeJsonParse } from '@/lib/utils'
import { METHOD_COLORS } from '@/lib/styles'
import { VarInput } from '@/components/ui/var-input'

import { METHOD_OPTIONS, PROTOCOL_OPTIONS } from '@/lib/constants'

export default function RequestPanel() {
  const { t } = useTranslation()
  const { currentRequest, loading, updateRequest, sendRequest } = useRequestStore()
  const confirmFn = useConfirmStore((s) => s.confirm)
  const [name, setName] = useState('')
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [nameSaveStatus, setNameSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const nameSaveIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KeyValuePair[]>([])
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([])
  const [bodyType, setBodyType] = useState('none')
  const [bodyContent, setBodyContent] = useState('')
  const [activeTab, setActiveTab] = useState('params')
  const [protocol, setProtocol] = useState('http')
  const { envVars, activeEnvName } = useEnvVars()

  useEffect(() => {
    if (currentRequest) {
      setName(currentRequest.name)
      setMethod(currentRequest.method)
      setUrl(currentRequest.url)
      setHeaders(safeJsonParse(currentRequest.headers, []))
      setQueryParams(safeJsonParse(currentRequest.query_params, []))
      setBodyType(currentRequest.body_type)
      setProtocol(currentRequest.protocol || 'http')
      // JSON 类型加载时自动格式化
      if (currentRequest.body_type === 'json' && currentRequest.body_content) {
        try {
          setBodyContent(JSON.stringify(JSON.parse(currentRequest.body_content), null, 2))
        } catch {
          setBodyContent(currentRequest.body_content)
        }
      } else {
        setBodyContent(currentRequest.body_content)
      }
    }
  }, [currentRequest])

  const isWebSocket = protocol === 'websocket'

  const [copied, setCopied] = useState(false)

  const formatJson = useCallback(() => {
    try {
      setBodyContent(JSON.stringify(JSON.parse(bodyContent), null, 2))
    } catch { /* 非法 JSON 不处理 */ }
  }, [bodyContent])

  const compactJson = useCallback(() => {
    try {
      setBodyContent(JSON.stringify(JSON.parse(bodyContent)))
    } catch { /* 非法 JSON 不处理 */ }
  }, [bodyContent])

  const copyBody = useCallback(async () => {
    await navigator.clipboard.writeText(bodyContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [bodyContent])

  const handleNameChange = (value: string) => {
    setName(value)
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(async () => {
      setNameSaveStatus('saving')
      await updateRequest({ name: value })
      setNameSaveStatus('saved')
      if (nameSaveIndicatorRef.current) clearTimeout(nameSaveIndicatorRef.current)
      nameSaveIndicatorRef.current = setTimeout(() => setNameSaveStatus('idle'), 1500)
    }, 500)
  }

  const flushName = () => {
    if (nameTimerRef.current) {
      clearTimeout(nameTimerRef.current)
      nameTimerRef.current = null
    }
    if (currentRequest && name !== currentRequest.name) {
      updateRequest({ name })
    }
  }

  // 用 ref 追踪最新 name，卸载时保存未提交的修改
  const nameRef = useRef(name)
  const requestRef = useRef(currentRequest)
  useEffect(() => { nameRef.current = name }, [name])
  useEffect(() => { requestRef.current = currentRequest }, [currentRequest])
  useEffect(() => () => {
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    if (nameSaveIndicatorRef.current) clearTimeout(nameSaveIndicatorRef.current)
    if (requestRef.current && nameRef.current !== requestRef.current.name) {
      useRequestStore.getState().updateRequest({ name: nameRef.current })
    }
  }, [])

  const handleProtocolChange = async (newProtocol: string) => {
    if (newProtocol === 'websocket' && bodyType !== 'none' && bodyType !== 'json' && bodyContent.trim()) {
      const ok = await confirmFn(t('request.protocol_switch_warning'), { title: t('request.protocol_switch'), kind: 'warning' })
      if (!ok) return
    }
    setProtocol(newProtocol)
    if (newProtocol === 'websocket') {
      setBodyType('json')
    }
    updateRequest({ protocol: newProtocol })
  }

  const handleSend = async () => {
    if (unresolvedUrlVars.length > 0) {
      const ok = await confirmFn(
        t('request.unresolved_vars_confirm', { vars: unresolvedUrlVars.join(', ') }),
        { title: t('request.send'), kind: 'warning' },
      )
      if (!ok) return
    }
    await updateRequest({
      method,
      url,
      headers: JSON.stringify(headers),
      queryParams: JSON.stringify(queryParams),
      bodyType: isWebSocket ? 'json' : bodyType,
      bodyContent,
      protocol,
    })
    await sendRequest()
  }

  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-qai-monaco-host]')) return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && !ae.closest('[data-request-url]') && !ae.closest('[data-qai-monaco-host]')) return
      e.preventDefault()
      void handleSendRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  const unresolvedUrlVars = useMemo(() => {
    const keys = [...url.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
    const uniq = [...new Set(keys)]
    return uniq.filter((k) => envVars[k] === undefined)
  }, [url, envVars])

  // 表单 body 的解析值（用于 form/form-data/urlencoded 类型）
  const formBody = useMemo(() => safeJsonParse(bodyContent, []), [bodyContent])

  return (
    <div className="space-y-4">
      {/* 请求名称 */}
      {currentRequest && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onBlur={flushName}
            className="text-sm font-medium bg-transparent border-0 outline-none text-foreground flex-1 min-w-[120px] px-0 placeholder:text-muted-foreground focus:ring-0"
            placeholder={t('request.name_placeholder')}
          />
          {nameSaveStatus !== 'idle' && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 shrink-0">
              <Cloud className={`h-3 w-3 ${nameSaveStatus === 'saving' ? 'animate-pulse' : 'text-success'}`} />
              {nameSaveStatus === 'saved' && t('env.saved')}
            </span>
          )}
          {activeEnvName && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t('request.active_env')}: <span className="text-success/90 font-medium">{activeEnvName}</span>
            </span>
          )}
        </div>
      )}

      {/* URL 栏 */}
      <div className="flex items-center gap-2">
        <Select value={protocol} onChange={handleProtocolChange} options={PROTOCOL_OPTIONS} className="w-20" />
        {isWebSocket ? (
          <div className="flex items-center gap-1 px-2 h-8 rounded-lg border border-input bg-overlay/[0.03] text-xs font-mono text-primary shrink-0">
            <Plug className="h-3 w-3" />
            WS
          </div>
        ) : (
          <Select value={method} onChange={setMethod} options={METHOD_OPTIONS} className={`w-28 ${METHOD_COLORS[method] ?? ''}`} />
        )}
        <VarInput
          data-request-url=""
          value={url}
          onChange={setUrl}
          placeholder={isWebSocket ? t('request.ws_url_placeholder') : t('request.url_placeholder')}
          envVars={envVars}
          className="flex-1 h-8"
          onBlur={() => updateRequest({ url })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) void handleSend() }}
        />
        <Button onClick={handleSend} disabled={loading} size="sm" className="gap-1.5 h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isWebSocket ? <Plug className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {isWebSocket ? t('request.connect') : t('request.send')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-muted-foreground/70">{t('request.shortcut_send')}</span>
        {unresolvedUrlVars.length > 0 && (
          <span className="text-warning/90">
            {t('request.unresolved_vars')}: {unresolvedUrlVars.join(', ')}
          </span>
        )}
      </div>

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {!isWebSocket && <TabsTrigger value="params">Params</TabsTrigger>}
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">{isWebSocket ? 'Payload' : 'Body'}</TabsTrigger>
          <TabsTrigger value="assertions">Assertions</TabsTrigger>
          <TabsTrigger value="extract">Extract</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        {!isWebSocket && (
          <TabsContent value="params">
            <KeyValueTable value={queryParams} onChange={setQueryParams} envVars={envVars} />
          </TabsContent>
        )}
        <TabsContent value="headers">
          <KeyValueTable value={headers} onChange={setHeaders} envVars={envVars} />
        </TabsContent>
        <TabsContent value="body">
          {isWebSocket ? (
            <WsStepsEditor
              value={bodyContent}
              onChange={setBodyContent}
              onBlur={() => updateRequest({ bodyContent })}
              onSubmit={() => { void handleSend() }}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-1">
                <BodyTypeSelector value={bodyType} onChange={setBodyType}>
                {bodyType === 'json' && bodyContent && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button onClick={formatJson} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors" title={t('request.format_json')}>
                      <Braces className="h-3 w-3" /> Format
                    </button>
                    <button onClick={compactJson} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors" title={t('request.compact_json')}>Compact</button>
                    <button onClick={copyBody} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors" title={t('request.copy')}>
                      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                )}
                </BodyTypeSelector>
              </div>
              {bodyType !== 'none' && bodyType !== 'form' && bodyType !== 'form-data' && bodyType !== 'urlencoded' && (
                <CodeEditor
                  value={bodyContent}
                  onChange={setBodyContent}
                  onBlur={() => updateRequest({ bodyContent })}
                  language={bodyType === 'json' ? 'json' : 'plaintext'}
                  placeholder='{ "key": "value" }'
                  className="h-[280px]"
                  onSubmitChord={() => { void handleSend() }}
                />
              )}
              {(bodyType === 'form' || bodyType === 'form-data' || bodyType === 'urlencoded') && (
                <KeyValueTable
                  value={formBody}
                  onChange={(v) => setBodyContent(JSON.stringify(v))}
                  allowFiles={bodyType === 'form-data'}
                  envVars={envVars}
                />
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="assertions">
          {currentRequest && <AssertionEditor requestId={currentRequest.id} />}
        </TabsContent>
        <TabsContent value="extract">
          {currentRequest && <ExtractRulesEditor requestId={currentRequest.id} />}
        </TabsContent>
        <TabsContent value="runs">
          {currentRequest && <RunsTab requestId={currentRequest.id} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
