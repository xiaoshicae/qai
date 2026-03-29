import { useMemo, useState } from 'react'
import { ArrowDownToLine, Clock, HardDrive, Plug, Download, Music, Image, Film, FileDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import AssertionResult from '@/components/assertion/assertion-result'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { formatDuration, formatSize } from '@/lib/formatters'

/** 从 data URI 中提取 MIME 和扩展名 */
function parseDataUri(body: string) {
  const mime = body.split(';')[0].replace('data:', '')
  const ext = {
    'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac', 'audio/mp4': 'm4a',
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  }[mime] || 'bin'
  return { mime, ext }
}

/** data URI → Uint8Array */
function dataUriToBytes(dataUri: string): Uint8Array {
  const base64 = dataUri.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 统一媒体预览组件 */
function MediaPreview({ body, sizeBytes }: { body: string; sizeBytes: number }) {
  const { mime, ext } = parseDataUri(body)
  const isAudio = mime.startsWith('audio/')
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')

  const handleSave = async () => {
    const path = await save({ defaultPath: `response.${ext}` })
    if (path) {
      await writeFile(path, dataUriToBytes(body))
    }
  }

  return (
    <div className="rounded-xl border border-overlay/[0.06] bg-card overflow-hidden">
      {/* 媒体预览 */}
      <div className="p-4">
        {isAudio && <audio controls src={body} className="w-full" />}
        {isImage && <img src={body} alt="Response" className="max-w-full max-h-[400px] rounded-lg object-contain" />}
        {isVideo && <video controls src={body} className="max-w-full max-h-[400px] rounded-lg" />}
        {!isAudio && !isImage && !isVideo && (
          <div className="flex flex-col items-center py-6 text-muted-foreground">
            <FileDown className="h-8 w-8 mb-2" />
            <span className="text-sm">二进制文件</span>
          </div>
        )}
      </div>
      {/* 底栏：元信息 + 下载 */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-overlay/[0.04] bg-overlay/[0.02]">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isAudio && <Music className="h-3 w-3" />}
          {isImage && <Image className="h-3 w-3" />}
          {isVideo && <Film className="h-3 w-3" />}
          <span>{mime}</span>
        </div>
        <span className="text-xs text-muted-foreground">{formatSize(sizeBytes)}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSave}>
          <Download className="h-3 w-3" /> 保存
        </Button>
      </div>
    </div>
  )
}

export default function ResponsePanel() {
  const { currentRequest, currentResponse, streaming, streamContent, streamChunks } = useRequestStore()
  const isWebSocket = currentRequest?.protocol === 'websocket'
  const [activeTab, setActiveTab] = useState('body')

  const response = currentResponse?.response
  const assertionResults = currentResponse?.assertion_results ?? []
  const passedCount = assertionResults.filter((r) => r.passed).length
  const failedCount = assertionResults.filter((r) => !r.passed).length

  const isMediaResponse = response?.body?.startsWith('data:audio/')
    || response?.body?.startsWith('data:image/')
    || response?.body?.startsWith('data:video/')
    || (response?.body?.startsWith('data:') && response?.body?.includes(';base64,'))

  const prettyBody = useMemo(() => {
    if (!response?.body || isMediaResponse) return ''
    try { return JSON.stringify(JSON.parse(response.body), null, 2) } catch { return response.body }
  }, [response?.body, isMediaResponse])

  const statusColor = useMemo(() => {
    if (!response) return 'secondary' as const
    const s = response.status
    if (s >= 200 && s < 300) return 'success' as const
    if (s >= 400) return 'destructive' as const
    return 'warning' as const
  }, [response?.status])

  // 流式传输中
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
          <span>{formatDuration(response.time_ms)}</span>
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
          {isMediaResponse ? (
            <MediaPreview body={response.body} sizeBytes={response.size_bytes} />
          ) : (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto bg-card p-4 rounded-xl border border-overlay/[0.06]">
              {prettyBody}
            </pre>
          )}
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
