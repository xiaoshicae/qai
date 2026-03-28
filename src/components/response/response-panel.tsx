import { useMemo, useState } from 'react'
import { ArrowDownToLine, Clock, HardDrive, Plug } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import AssertionResult from '@/components/assertion/assertion-result'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export default function ResponsePanel() {
  const { currentRequest, currentResponse, streaming, streamContent, streamChunks } = useRequestStore()
  const isWebSocket = currentRequest?.protocol === 'websocket'
  const [activeTab, setActiveTab] = useState('body')

  const response = currentResponse?.response
  const assertionResults = currentResponse?.assertion_results ?? []
  const passedCount = assertionResults.filter((r) => r.passed).length
  const failedCount = assertionResults.filter((r) => !r.passed).length

  const prettyBody = useMemo(() => {
    if (!response?.body) return ''
    try { return JSON.stringify(JSON.parse(response.body), null, 2) } catch { return response.body }
  }, [response?.body])

  const statusColor = useMemo(() => {
    if (!response) return 'secondary' as const
    const s = response.status
    if (s >= 200 && s < 300) return 'success' as const
    if (s >= 400) return 'destructive' as const
    return 'warning' as const
  }, [response?.status])

  // 流式传输中：实时显示内容
  if (streaming && streamContent) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Badge variant="secondary">Streaming...</Badge>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Chunks: {streamChunks}</span>
          </div>
          <div className="ml-auto">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto bg-card p-4 rounded-xl border border-overlay/[0.06]">
          {streamContent}
          <span className="animate-pulse">|</span>
        </pre>
      </div>
    )
  }

  if (!currentResponse) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <ArrowDownToLine className="h-5 w-5 text-muted-foreground/30 mb-2" />
        <span className="text-sm text-muted-foreground/50">发送请求查看响应</span>
      </div>
    )
  }

  if (currentResponse.error_message && !response) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4 text-sm">
        <p className="font-medium text-destructive mb-1">请求失败</p>
        <p className="text-xs text-muted-foreground font-mono">{currentResponse.error_message}</p>
      </div>
    )
  }

  if (!response) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {isWebSocket ? (
          <Badge variant={currentResponse.status === 'success' ? 'success' : 'destructive'}>
            <Plug className="h-3 w-3 mr-1" />
            {currentResponse.status === 'success' ? 'Connected' : 'Failed'}
          </Badge>
        ) : (
          <Badge variant={statusColor}>{response.status} {response.status_text}</Badge>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{formatTime(response.time_ms)}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <HardDrive className="h-3 w-3" />
          <span>{formatSize(response.size_bytes)}</span>
        </div>
        {assertionResults.length > 0 && (
          <div className="ml-auto">
            {failedCount === 0
              ? <Badge variant="success">{passedCount}/{assertionResults.length} 通过</Badge>
              : <Badge variant="destructive">{failedCount} 失败</Badge>
            }
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="body">{isWebSocket ? 'Messages' : 'Body'}</TabsTrigger>
          <TabsTrigger value="headers">{isWebSocket ? 'Info' : 'Headers'} ({response.headers.length})</TabsTrigger>
          {assertionResults.length > 0 && (
            <TabsTrigger value="tests">Tests ({passedCount}/{assertionResults.length})</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="body">
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto bg-card p-4 rounded-xl border border-overlay/[0.06]">
            {prettyBody}
          </pre>
        </TabsContent>
        <TabsContent value="headers">
          <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
            {response.headers.map((h, i) => (
              <div key={h.key} className={`flex gap-3 px-4 py-2 text-xs font-mono ${i % 2 === 0 ? 'bg-card' : 'bg-transparent'}`}>
                <span className="text-primary font-medium min-w-[180px] shrink-0">{h.key}</span>
                <span className="text-foreground/70 break-all">{h.value}</span>
              </div>
            ))}
          </div>
        </TabsContent>
        {assertionResults.length > 0 && (
          <TabsContent value="tests">
            <AssertionResult results={assertionResults} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
