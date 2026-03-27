import { useState, useEffect, useCallback } from 'react'
import { Send, Loader2, Radio, Braces, Copy, Check } from 'lucide-react'
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

export default function RequestPanel() {
  const { currentRequest, loading, updateRequest, sendRequest, sendRequestStream } = useRequestStore()
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KeyValuePair[]>([])
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([])
  const [bodyType, setBodyType] = useState('none')
  const [bodyContent, setBodyContent] = useState('')
  const [activeTab, setActiveTab] = useState('params')

  useEffect(() => {
    if (currentRequest) {
      setMethod(currentRequest.method)
      setUrl(currentRequest.url)
      setHeaders(JSON.parse(currentRequest.headers || '[]'))
      setQueryParams(JSON.parse(currentRequest.query_params || '[]'))
      setBodyType(currentRequest.body_type)
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

  const handleSend = async () => {
    await updateRequest({
      method,
      url,
      headers: JSON.stringify(headers),
      queryParams: JSON.stringify(queryParams),
      bodyType,
      bodyContent,
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
        <Select value={method} onChange={setMethod} options={METHOD_OPTIONS} className={`w-28 ${METHOD_COLORS[method] ?? ''}`} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="输入请求 URL"
          className="flex-1 h-8 rounded-lg border border-input bg-transparent px-3 text-sm font-mono placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors"
          onBlur={() => updateRequest({ url })}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button onClick={handleSend} disabled={loading} size="sm" className="gap-1.5 h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          发送
        </Button>
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
      </div>

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="params">Params</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="assertions">Assertions</TabsTrigger>
          <TabsTrigger value="extract">Extract</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="params">
          <KeyValueTable value={queryParams} onChange={setQueryParams} />
        </TabsContent>
        <TabsContent value="headers">
          <KeyValueTable value={headers} onChange={setHeaders} />
        </TabsContent>
        <TabsContent value="body">
          <div className="mb-3 flex items-center gap-1">
            {['none', 'json', 'form', 'raw'].map((t) => (
              <button
                key={t}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  bodyType === t
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setBodyType(t)}
              >
                {t === 'none' ? 'None' : t.toUpperCase()}
              </button>
            ))}
            {bodyType === 'json' && bodyContent && (
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={formatJson}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                  title="格式化 JSON"
                >
                  <Braces className="h-3 w-3" />
                  Format
                </button>
                <button
                  onClick={compactJson}
                  className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                  title="压缩 JSON"
                >
                  Compact
                </button>
                <button
                  onClick={copyBody}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                  title="复制"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>
          {bodyType !== 'none' && bodyType !== 'form' && (
            <Textarea
              value={bodyContent}
              onChange={(e) => setBodyContent(e.target.value)}
              onBlur={() => updateRequest({ bodyContent })}
              placeholder='{ "key": "value" }'
              rows={10}
              className="font-mono text-xs leading-relaxed"
            />
          )}
          {bodyType === 'form' && (
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
            />
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
