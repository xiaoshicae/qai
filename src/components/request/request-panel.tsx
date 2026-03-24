import { useState, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import KeyValueTable from './key-value-table'
import AssertionEditor from '@/components/assertion/assertion-editor'
import RunsTab from './runs-tab'
import type { KeyValuePair } from '@/types'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  DELETE: 'text-method-delete',
  PATCH: 'text-method-patch',
  HEAD: 'text-method-head',
}

export default function RequestPanel() {
  const { currentRequest, loading, updateRequest, sendRequest } = useRequestStore()
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
      setBodyContent(currentRequest.body_content)
    }
  }, [currentRequest])

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
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className={`h-8 rounded-lg border border-input bg-transparent px-2 text-xs font-bold cursor-pointer focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${METHOD_COLORS[method] ?? ''}`}
          style={{ backgroundImage: 'none', paddingRight: '8px' }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="输入请求 URL"
          className="flex-1 h-8 rounded-lg border border-input bg-transparent px-3 text-sm font-mono placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors dark:bg-input/30"
          onBlur={() => updateRequest({ url })}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button onClick={handleSend} disabled={loading} size="sm" className="gap-1.5 h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          发送
        </Button>
      </div>

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="params">Params</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="assertions">Assertions</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="params">
          <KeyValueTable value={queryParams} onChange={setQueryParams} />
        </TabsContent>
        <TabsContent value="headers">
          <KeyValueTable value={headers} onChange={setHeaders} />
        </TabsContent>
        <TabsContent value="body">
          <div className="mb-3 flex gap-1">
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
          </div>
          {bodyType !== 'none' && bodyType !== 'form' && (
            <Textarea
              value={bodyContent}
              onChange={(e) => setBodyContent(e.target.value)}
              placeholder='{ "key": "value" }'
              rows={8}
              className="font-mono text-xs"
            />
          )}
          {bodyType === 'form' && (
            <KeyValueTable
              value={JSON.parse(bodyContent || '[]')}
              onChange={(v) => setBodyContent(JSON.stringify(v))}
            />
          )}
        </TabsContent>
        <TabsContent value="assertions">
          {currentRequest && <AssertionEditor requestId={currentRequest.id} />}
        </TabsContent>
        <TabsContent value="runs">
          {currentRequest && <RunsTab requestId={currentRequest.id} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
