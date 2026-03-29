import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Send, Loader2, Radio, Braces, Copy, Check, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import KeyValueTable from './key-value-table'
import AssertionEditor from '@/components/assertion/assertion-editor'
import ExtractRulesEditor from './extract-rules-editor'
import RunsTab from './runs-tab'
import type { KeyValuePair } from '@/types'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const
const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: m }))

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

const PROTOCOL_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'websocket', label: 'WS' },
]

export default function RequestPanel() {
  const { currentRequest, loading, updateRequest, sendRequest, sendRequestStream } = useRequestStore()
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KeyValuePair[]>([])
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([])
  const [bodyType, setBodyType] = useState('none')
  const [bodyContent, setBodyContent] = useState('')
  const [activeTab, setActiveTab] = useState('params')
  const [protocol, setProtocol] = useState('http')
  const [envVars, setEnvVars] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadEnvVars = async () => {
      try {
        const envs = await invoke<{ id: string; name: string; is_active: boolean }[]>('list_environments')
        const active = envs.find((e) => e.is_active)
        if (active) {
          const data = await invoke<{ variables: { key: string; value: string; enabled: boolean }[] }>('get_environment_with_vars', { id: active.id })
          const map: Record<string, string> = {}
          for (const v of data.variables) if (v.enabled) map[v.key] = v.value
          setEnvVars(map)
        } else {
          setEnvVars({})
        }
      } catch {}
    }
    loadEnvVars()
    window.addEventListener('env-changed', loadEnvVars)
    return () => window.removeEventListener('env-changed', loadEnvVars)
  }, [])

  useEffect(() => {
    if (currentRequest) {
      setMethod(currentRequest.method)
      setUrl(currentRequest.url)
      setHeaders(JSON.parse(currentRequest.headers || '[]'))
      setQueryParams(JSON.parse(currentRequest.query_params || '[]'))
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

  const handleProtocolChange = (newProtocol: string) => {
    setProtocol(newProtocol)
    if (newProtocol === 'websocket') {
      setBodyType('json')
    }
    updateRequest({ protocol: newProtocol })
  }

  const handleSend = async () => {
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

  return (
    <div className="space-y-4">
      {/* 请求名称 */}
      {currentRequest && (
        <input
          value={currentRequest.name}
          onChange={(e) => updateRequest({ name: e.target.value })}
          className="text-sm font-medium bg-transparent border-0 outline-none text-foreground w-full px-0 placeholder:text-muted-foreground focus:ring-0"
          placeholder="请求名称"
        />
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
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={isWebSocket ? '输入 WebSocket URL (ws:// 或 wss://)' : '输入请求 URL'}
          className="flex-1 h-8 rounded-lg border border-input bg-transparent px-3 text-sm font-mono placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors"
          onBlur={() => updateRequest({ url })}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button onClick={handleSend} disabled={loading} size="sm" className="gap-1.5 h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isWebSocket ? <Plug className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {isWebSocket ? '连接' : '发送'}
        </Button>
        {!isWebSocket && (
          <Button
            variant="outline"
            onClick={async () => {
              await updateRequest({ method, url, headers: JSON.stringify(headers), queryParams: JSON.stringify(queryParams), bodyType, bodyContent })
              await sendRequestStream()
            }}
            disabled={loading}
            size="sm"
            className="gap-1.5 h-8"
            title="流式发送 (SSE)"
          >
            <Radio className="h-3.5 w-3.5" />
            Stream
          </Button>
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
            <>
              <div className="mb-3 flex items-center gap-1">
                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-foreground">JSON</span>
                {bodyContent && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button onClick={formatJson} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="格式化 JSON">
                      <Braces className="h-3 w-3" /> Format
                    </button>
                    <button onClick={compactJson} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="压缩 JSON">Compact</button>
                    <button onClick={copyBody} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="复制">
                      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                )}
              </div>
              <Textarea
                value={bodyContent}
                onChange={(e) => setBodyContent(e.target.value)}
                onBlur={() => updateRequest({ bodyContent })}
                placeholder='{ "text": "Hello", "voice": "Linda" }'
                rows={10}
                className="font-mono text-xs leading-relaxed"
              />
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-1">
                {['none', 'form-data', 'urlencoded', 'json', 'raw'].map((t) => {
                  const label: Record<string, string> = { none: 'None', 'form-data': 'Form Data', urlencoded: 'URL Encoded', json: 'JSON', raw: 'Raw' }
                  return (
                    <button
                      key={t}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        bodyType === t
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setBodyType(t)}
                    >
                      {label[t] ?? t}
                    </button>
                  )
                })}
                {bodyType === 'json' && bodyContent && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button onClick={formatJson} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="格式化 JSON">
                      <Braces className="h-3 w-3" /> Format
                    </button>
                    <button onClick={compactJson} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="压缩 JSON">Compact</button>
                    <button onClick={copyBody} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors" title="复制">
                      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                )}
              </div>
              {bodyType !== 'none' && bodyType !== 'form' && bodyType !== 'form-data' && bodyType !== 'urlencoded' && (
                <Textarea
                  value={bodyContent}
                  onChange={(e) => setBodyContent(e.target.value)}
                  onBlur={() => updateRequest({ bodyContent })}
                  placeholder='{ "key": "value" }'
                  rows={10}
                  className="font-mono text-xs leading-relaxed"
                />
              )}
              {(bodyType === 'form' || bodyType === 'form-data' || bodyType === 'urlencoded') && (
                <KeyValueTable
                  value={(() => {
                    try {
                      const parsed = JSON.parse(bodyContent || '[]')
                      return Array.isArray(parsed) ? parsed : []
                    } catch {
                      return []
                    }
                  })()}
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
