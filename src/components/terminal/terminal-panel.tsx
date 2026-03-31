import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Plus, X, ArrowUp, Square, Wrench, Slash, RotateCcw, Cpu, Zap, Brain, PlusCircle, ChevronRight, Terminal, FileText, FileEdit, Search, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
}

interface ClaudeEvent {
  event_type: string
  content: string
  raw?: any
}

const THINKING_WORDS = ['Thinking...', 'Pondering...', 'Analyzing...', 'Reasoning...', 'Frolicking...']

export default function TerminalPanel({ onClose }: Props) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [firstMessage, setFirstMessage] = useState(true)
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null)
  const [thinkingWord, setThinkingWord] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const [warmupStatus, setWarmupStatus] = useState<'idle' | 'warming' | 'ready'>('idle')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mountedRef = useRef(true)

  // 面板打开时：检查 app 级预热状态，监听完成事件
  useEffect(() => {
    mountedRef.current = true
    let unlisten: (() => void) | undefined

    const init = async () => {
      // 准备 MCP 配置
      try {
        const configPath = await invoke<string>('prepare_mcp_config')
        if (mountedRef.current) setMcpConfigPath(configPath)
      } catch {}

      // 检查 app 启动时的预热是否已完成
      try {
        const ready = await invoke<boolean>('claude_session_ready')
        if (ready) {
          if (mountedRef.current) { setWarmupStatus('ready'); setFirstMessage(false) }
          return
        }
      } catch {}

      // 未就绪 — 等待 app 级预热完成
      if (mountedRef.current) setWarmupStatus('warming')
      listen('claude-warmup-done', () => {
        if (mountedRef.current) { setWarmupStatus('ready'); setFirstMessage(false) }
      }).then((fn) => { unlisten = fn })
    }

    init()
    return () => { mountedRef.current = false; unlisten?.() }
  }, [])

  useEffect(() => {
    let cancelled = false

    const unlistenPromise = listen<ClaudeEvent>('claude-event', (event) => {
      if (cancelled || !mountedRef.current) return
      const { event_type, content } = event.payload
      if (event_type === 'delta') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + content }]
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', content }]
        })
      } else if (event_type === 'tool_use') {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'tool', content }])
      } else if (event_type === 'result') {
        setSending(false)
        setFirstMessage(false)
      }
    })

    return () => {
      cancelled = true
      unlistenPromise.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sending) return
    setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
    const interval = setInterval(() => {
      setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
    }, 3000)
    return () => clearInterval(interval)
  }, [sending])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }])
    setSending(true)
    try {
      await invoke('claude_send', { message: text, mcpConfigPath })
    } catch (e: any) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', content: `${e}` }])
      setSending(false)
    }
  }

  const handleStop = () => { invoke('claude_stop').catch(() => {}); setSending(false) }

  const sendSlashCommand = async (cmd: string) => {
    if (sending) return
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: cmd }])
    setSending(true)
    try {
      await invoke('claude_send', { message: cmd, mcpConfigPath })
    } catch (e: any) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', content: `${e}` }])
      setSending(false)
    }
  }

  const handleNewSession = async () => {
    invoke('claude_stop').catch(() => {})
    invoke('claude_reset_session').catch(() => {})
    setMessages([])
    setSending(false)
    setFirstMessage(true)
    setWarmupStatus('warming')
    inputRef.current?.focus()
    // 重新预热（带 MCP）
    try {
      await invoke('claude_warmup', { mcpConfigPath })
      if (mountedRef.current) { setWarmupStatus('ready'); setFirstMessage(false) }
    } catch {
      if (mountedRef.current) setWarmupStatus('idle')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-overlay/[0.08] shrink-0" data-tauri-drag-region="">
        <div className="flex items-center gap-2">
          <ClaudeLogo />
          <span className="text-xs font-medium">Claude Code</span>
          {warmupStatus === 'warming' && <span className="text-[9px] text-amber-500 dark:text-amber-400 animate-pulse">{t('claude.warming_up')}</span>}
          {warmupStatus === 'ready' && mcpConfigPath && <span className="text-[9px] text-emerald-500 font-medium">MCP</span>}
          {warmupStatus === 'ready' && !mcpConfigPath && <span className="text-[9px] text-emerald-500">{t('claude.warmed_up')}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleNewSession} className="p-1 rounded hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="新建会话">
            <PlusCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="关闭">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="h-12 w-12 rounded-2xl bg-overlay/[0.04] border border-overlay/[0.06] flex items-center justify-center">
              <ClaudeLogo size={24} />
            </div>
            <p className="text-sm font-medium mt-3">Claude Code</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
              {warmupStatus === 'warming' ? t('claude.warming_hint') : warmupStatus === 'ready' ? t('claude.ready') : firstMessage ? t('claude.first_msg') : t('claude.ready')}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'user') return (
            <div key={msg.id} className="rounded-xl border border-overlay/[0.08] bg-overlay/[0.04] px-3.5 py-2.5 text-sm">
              {msg.content}
            </div>
          )
          if (msg.role === 'assistant') return (
            <div key={msg.id} className="flex gap-2.5">
              <div className="shrink-0 mt-1">
                <ClaudeLogo size={14} />
              </div>
              <div className="text-sm leading-relaxed min-w-0 prose prose-sm dark:prose-invert max-w-none
                [&_pre]:bg-overlay/[0.06] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:border [&_pre]:border-overlay/[0.06]
                [&_code]:text-xs [&_code]:bg-overlay/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono
                [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
                [&_table]:border-collapse [&_table]:w-full [&_table]:text-xs
                [&_th]:border [&_th]:border-overlay/[0.08] [&_th]:bg-overlay/[0.04] [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold
                [&_td]:border [&_td]:border-overlay/[0.06] [&_td]:px-3 [&_td]:py-1.5
                [&_tr:hover]:bg-overlay/[0.03]
                [&_strong]:font-semibold
                [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2
                [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5
                [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1
                [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic
                [&_hr]:border-overlay/[0.06] [&_hr]:my-3
                [&_a]:text-primary [&_a]:no-underline [&_a]:hover:underline
              ">
                <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
              </div>
            </div>
          )
          if (msg.role === 'tool') return <ToolCallCard key={msg.id} content={msg.content} />
          return <div key={msg.id} className="text-xs text-destructive/80 ml-6 px-2 py-1 rounded-lg bg-destructive/5 border border-destructive/10">{msg.content}</div>
        })}

        {sending && (
          <div className="flex items-center gap-2.5 ml-0.5">
            <ClaudeLogo />
            <span className="text-sm text-[#D97757] animate-pulse">{thinkingWord}</span>
            {firstMessage && warmupStatus !== 'ready' && <span className="text-[10px] text-muted-foreground/50">{t('claude.first_init')}</span>}
          </div>
        )}
      </div>

      {/* + 操作菜单 */}
      {showActions && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
          <div className="relative z-50 mx-3 mb-1 rounded-xl border border-overlay/[0.1] bg-background shadow-2xl overflow-hidden">
            <div className="py-1">
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Context</div>
              <ActionItem icon={<RotateCcw className="h-3.5 w-3.5" />} label={t('claude.clear')} onClick={() => { setShowActions(false); handleNewSession() }} />

              <div className="h-px bg-overlay/[0.06] my-1" />
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Model</div>
              <ActionItem icon={<Cpu className="h-3.5 w-3.5" />} label={t('claude.switch_model')} onClick={() => { setShowActions(false); setInput('/model '); inputRef.current?.focus() }} />
              <ActionItem icon={<Zap className="h-3.5 w-3.5" />} label={t('claude.fast_mode')} onClick={() => { setShowActions(false); sendSlashCommand('/fast') }} />
              <ActionItem icon={<Brain className="h-3.5 w-3.5" />} label={t('claude.cost')} onClick={() => { setShowActions(false); sendSlashCommand('/cost') }} />
            </div>
          </div>
        </>
      )}

      {/* / 斜杠命令菜单 */}
      {showSlash && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSlash(false)} />
          <div className="relative z-50 mx-3 mb-1 rounded-xl border border-overlay/[0.1] bg-background shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
            <div className="py-1">
              {[
                { cmd: '/compact', desc: t('claude.slash_compact') },
                { cmd: '/cost', desc: t('claude.slash_cost') },
                { cmd: '/model sonnet', desc: 'Switch to Sonnet' },
                { cmd: '/model opus', desc: 'Switch to Opus' },
                { cmd: '/model haiku', desc: 'Switch to Haiku' },
                { cmd: '/fast', desc: t('claude.fast_mode') },
                { cmd: '/help', desc: t('claude.slash_help') },
              ].map((item) => (
                <button
                  key={item.cmd}
                  onClick={() => { setShowSlash(false); sendSlashCommand(item.cmd) }}
                  className="flex items-center gap-3 w-full px-3 py-1.5 text-xs hover:bg-overlay/[0.04] cursor-pointer transition-colors"
                >
                  <span className="font-mono text-primary/80">{item.cmd}</span>
                  <span className="text-muted-foreground">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 输入区域 */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="rounded-xl border border-overlay/[0.1] bg-overlay/[0.02] focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('claude.placeholder')}
            rows={1}
            disabled={sending}
            className="w-full px-3 py-2 pr-12 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/40 max-h-32 overflow-y-auto disabled:opacity-50"
          />
          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-2 pb-1.5">
            <div className="flex items-center gap-0.5">
              <button onClick={() => { setShowActions(!showActions); setShowSlash(false) }} className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="操作菜单">
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button onClick={() => { setShowSlash(!showSlash); setShowActions(false) }} className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="斜杠命令">
                <Slash className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              {sending ? (
                <button onClick={handleStop} className="h-7 w-7 flex items-center justify-center rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive cursor-pointer transition-colors" title="停止">
                  <Square className="h-3 w-3" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={!input.trim()} className="h-7 w-7 flex items-center justify-center rounded-lg btn-gradient text-primary-foreground disabled:opacity-30 cursor-pointer transition-all" title="发送">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionItem({ icon, label, badge, onClick }: { icon: React.ReactNode; label: string; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs hover:bg-overlay/[0.04] cursor-pointer transition-colors">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge && <span className="text-[9px] text-emerald-500 font-medium">{badge}</span>}
    </button>
  )
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Bash: <Terminal className="h-3 w-3" />,
  Read: <FileText className="h-3 w-3" />,
  Write: <FileEdit className="h-3 w-3" />,
  Edit: <FileEdit className="h-3 w-3" />,
  Glob: <Search className="h-3 w-3" />,
  Grep: <Search className="h-3 w-3" />,
  WebSearch: <Globe className="h-3 w-3" />,
  WebFetch: <Globe className="h-3 w-3" />,
}

function ToolCallCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  // content 格式: "ToolName: detail..."
  const colonIdx = content.indexOf(': ')
  const toolName = colonIdx > 0 ? content.slice(0, colonIdx) : content
  const detail = colonIdx > 0 ? content.slice(colonIdx + 2) : ''
  const icon = TOOL_ICONS[toolName] || <Wrench className="h-3 w-3" />

  return (
    <div className="ml-6 py-0.5">
      <button
        onClick={() => detail && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 text-xs text-muted-foreground/70 rounded-lg px-2 py-1 transition-colors ${detail ? 'hover:bg-overlay/[0.04] cursor-pointer' : ''}`}
      >
        {detail && <ChevronRight className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />}
        <span className="text-primary/50">{icon}</span>
        <span className="font-medium">{toolName}</span>
      </button>
      {expanded && detail && (
        <div className="ml-6 mt-1 text-[11px] font-mono text-muted-foreground/60 bg-overlay/[0.03] border border-overlay/[0.04] rounded-lg px-2.5 py-1.5 break-all leading-relaxed">
          {detail}
        </div>
      )}
    </div>
  )
}

function ClaudeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 49" fill="none" className="shrink-0">
      <path d="M23.15 45.53l.66-2.91.75-3.76.61-3.01.57-3.71.33-1.22-.05-.1-.23.05-2.82 3.85-4.28 5.78-3.38 3.57-.8.33-1.41-.7.14-1.32.8-1.13 4.65-5.97 2.82-3.71 1.83-2.12-.05-.28h-.09L10.79 37.25l-2.21.28-1-.89.15-1.46.47-.47 3.71-2.58 9.26-5.17.14-.47-.14-.24h-.47l-1.55-.09-5.26-.14-4.56-.19-4.47-.24-1.13-.23-1.03-1.41.09-.71.94-.61 1.36.09 2.96.24 4.47.28 3.24.19 4.8.52h.75l.09-.33-.24-.19-.19-.19-4.65-3.1-4.98-3.29-2.63-1.93-1.41-.99-.7-.89-.29-1.97 1.27-1.41 1.74.14.42.09 1.74 1.36 3.71 2.87 4.89 3.62.7.56.33-.19v-.14l-.33-.52-2.63-4.79-2.82-4.89-1.27-2.02-.33-1.22c-.13-.42-.19-.89-.19-1.41l1.46-1.97.8-.28 1.97.28.8.7 1.22 2.77 1.93 4.37 3.05 5.92.9 1.79.47 1.6.19.52h.33v-.28l.24-3.38.47-4.09.47-5.26.14-1.5.75-1.79 1.46-.94 1.13.52.94 1.36-.14.85-.52 3.62-1.13 5.69-.7 3.85h.42l.47-.52 1.93-2.54 3.24-4.04 1.41-1.6 1.69-1.79 1.08-.85h2.02l1.46 2.21-.66 2.3-2.07 2.63-1.74 2.21-2.49 3.34-1.5 2.68.14.19h.33l5.59-1.22 3.05-.52 3.57-.61 1.65.75.19.75-.66 1.6-3.85.94-4.51.89-6.72 1.6-.09.05.09.14 3.01.28 1.32.09h3.19l5.92.42 1.55 1.03.9 1.22-.14.99-2.4 1.18-3.19-.75-7.52-1.79-2.54-.61h-.38v.19l2.16 2.12 3.9 3.52 4.94 4.56.24 1.13-.61.94-.66-.09-4.32-3.29-1.69-1.46-3.76-3.15h-.24v.33l.85 1.27 4.61 6.91.24 2.12-.33.66-1.22.42-1.27-.24-2.73-3.76-2.77-4.28-2.26-3.81-.24.19-1.36 14.19-.61.71-1.41.56-1.18-.89-.66-1.46z" fill="#D97757" />
    </svg>
  )
}
