import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, Clock, HardDrive, Plug, Download, Music, Image, Film, FileDown, CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRequestStore } from '@/stores/request-store'
import { JsonHighlight } from '@/components/ui/json-highlight'
import { useBodySearch, BodySearchBar } from '@/components/ui/body-search-bar'
import AssertionResult from '@/components/assertion/assertion-result'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { formatDuration, formatSize } from '@/lib/formatters'
import { extractBase64Media, redactBase64Fields } from '@/lib/media'

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
  const { t } = useTranslation()
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
            <span className="text-sm">{t('response.binary_file')}</span>
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
          <Download className="h-3 w-3" /> {t('response.save')}
        </Button>
      </div>
    </div>
  )
}

interface WsStepData {
  step: number
  sent: unknown
  received: unknown[]
  binary_bytes: number
  status: string
  error: string | null
  time_ms: number
}

function WsStepResults({ steps }: { steps: WsStepData[] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.step} className="rounded-xl border border-overlay/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-overlay/[0.02]">
            <span className="text-xs font-medium">{t('ws.step_n', { n: step.step })}</span>
            {step.status === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
            <span className="text-[10px] text-muted-foreground">{formatDuration(step.time_ms)}</span>
            {step.binary_bytes > 0 && (
              <span className="text-[10px] text-muted-foreground">{formatSize(step.binary_bytes)}</span>
            )}
          </div>
          <div className="divide-y divide-overlay/[0.04]">
            <div className="px-3 py-2">
              <div className="text-[10px] text-muted-foreground mb-1">{t('ws.sent')}</div>
              <pre className="font-mono text-xs text-foreground/80 whitespace-pre-wrap break-all">
                {typeof step.sent === 'string' ? step.sent : JSON.stringify(step.sent, null, 2)}
              </pre>
            </div>
            {step.received.length > 0 && (
              <div className="px-3 py-2">
                <div className="text-[10px] text-muted-foreground mb-1">{t('ws.received')}</div>
                <pre className="font-mono text-xs text-foreground/80 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                  {JSON.stringify(step.received.length === 1 ? step.received[0] : step.received, null, 2)}
                </pre>
              </div>
            )}
            {step.error && (
              <div className="px-3 py-2">
                <span className="text-xs text-destructive">{step.error}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ResponsePanel() {
  const { t } = useTranslation()
  const { currentRequest, currentResponse, streaming, streamContent, streamChunks } = useRequestStore()
  const isWebSocket = currentRequest?.protocol === 'websocket'
  const [activeTab, setActiveTab] = useState('body')
  const bodySearch = useBodySearch()

  const response = currentResponse?.response
  const assertionResults = currentResponse?.assertion_results ?? []
  const passedCount = assertionResults.filter((r) => r.passed).length
  const failedCount = assertionResults.filter((r) => !r.passed).length

  // WebSocket 多步结果检测
  const wsStepsData = useMemo<WsStepData[] | null>(() => {
    if (!isWebSocket || !response?.body) return null
    try {
      const data = JSON.parse(response.body)
      if (data._ws_steps && Array.isArray(data.steps)) {
        return data.steps as WsStepData[]
      }
    } catch { /* not ws steps */ }
    return null
  }, [isWebSocket, response?.body])

  const isMediaResponse = response?.body?.startsWith('data:audio/')
    || response?.body?.startsWith('data:image/')
    || response?.body?.startsWith('data:video/')
    || (response?.body?.startsWith('data:') && response?.body?.includes(';base64,'))

  // JSON 内嵌 base64 媒体检测
  const embeddedMedia = useMemo(() => {
    if (!response?.body || isMediaResponse) return []
    try {
      return extractBase64Media(JSON.parse(response.body))
    } catch { return [] }
  }, [response?.body, isMediaResponse])

  const prettyBody = useMemo(() => {
    if (!response?.body || isMediaResponse) return ''
    try {
      const parsed = JSON.parse(response.body)
      const display = embeddedMedia.length > 0 ? redactBase64Fields(parsed, embeddedMedia) : parsed
      return JSON.stringify(display, null, 2)
    } catch { return response.body }
  }, [response?.body, isMediaResponse, embeddedMedia])

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
        <span className="text-sm text-muted-foreground/50">{t('response.send_hint')}</span>
      </div>
    )
  }

  if (currentResponse.error_message && !response) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4 text-sm">
        <p className="font-medium text-destructive mb-1">{t('response.request_failed')}</p>
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
              ? <Badge variant="success">{t('response.passed', { passed: passedCount, total: assertionResults.length })}</Badge>
              : <Badge variant="destructive">{t('response.failed', { count: failedCount })}</Badge>
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
          {wsStepsData ? (
            <WsStepResults steps={wsStepsData} />
          ) : isMediaResponse ? (
            <MediaPreview body={response.body} sizeBytes={response.size_bytes} />
          ) : (
            <div className="relative" {...bodySearch.containerHandlers}>
              {bodySearch.isOpen && (
                <div className="absolute right-2 top-2 z-10">
                  <BodySearchBar matchCount={bodySearch.matchCount} activeIndex={bodySearch.activeIndex} onSearch={bodySearch.updateTerm} onNext={bodySearch.next} onPrev={bodySearch.prev} onClose={bodySearch.close} />
                </div>
              )}
              {embeddedMedia.length > 0 && (
                <div className="space-y-2 mb-3">
                  {embeddedMedia.map((m, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] p-3 overflow-hidden">
                      {m.type === 'image' && <img src={m.dataUrl} alt={m.path} className="max-h-40 max-w-[240px] object-contain rounded-lg shrink-0" />}
                      {m.type === 'audio' && <audio controls src={m.dataUrl} className="w-full max-w-sm shrink-0" />}
                      {m.type === 'video' && <video controls src={m.dataUrl} className="max-h-40 max-w-[240px] rounded-lg shrink-0" />}
                      <div className="text-xs text-muted-foreground min-w-0">
                        <div className="font-mono truncate">{m.path}</div>
                        <div className="mt-0.5">{formatSize(m.sizeBytes)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <JsonHighlight
                code={prettyBody}
                className="leading-relaxed whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto bg-card p-4 rounded-xl border border-overlay/[0.06]"
                searchTerm={bodySearch.term}
                activeMatchIndex={bodySearch.activeIndex}
                onMatchCount={bodySearch.handleMatchCount}
              />
            </div>
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
