import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Plus, X, ArrowUp, Square, Wrench, Slash, PlusCircle, RotateCcw, Cpu, Zap, Brain } from 'lucide-react'
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [firstMessage, setFirstMessage] = useState(true)
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null)
  const [thinkingWord, setThinkingWord] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    invoke<string>('prepare_mcp_config').then(setMcpConfigPath).catch(() => {})
    return () => { mountedRef.current = false }
  }, [])

  // 用 ref 追踪 unlisten，防止 StrictMode 双注册
  const unlistenRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    // 先清理旧 listener
    unlistenRef.current?.()
    unlistenRef.current = undefined

    listen<ClaudeEvent>('claude-event', (event) => {
      if (!mountedRef.current) return
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
    }).then((fn) => { unlistenRef.current = fn })

    return () => { unlistenRef.current?.(); unlistenRef.current = undefined }
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
      // result 事件会触发 setSending(false)
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

  const handleNewSession = () => {
    invoke('claude_stop').catch(() => {})
    invoke('claude_reset_session').catch(() => {})
    setMessages([])
    setSending(false)
    setFirstMessage(true)
    inputRef.current?.focus()
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
          {mcpConfigPath && <span className="text-[9px] text-emerald-500 font-medium">MCP</span>}
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ClaudeLogo size={28} />
            <p className="text-sm font-medium mt-3">Claude Code</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
              {firstMessage ? '首次对话需要 10-30 秒初始化，后续秒回。' : '已就绪，描述你的需求。'}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'user') return <div key={msg.id} className="rounded-xl bg-overlay/[0.06] px-3.5 py-2.5 text-sm">{msg.content}</div>
          if (msg.role === 'assistant') return (
            <div key={msg.id} className="flex gap-2.5">
              <div className="shrink-0 mt-0.5 h-4 w-4 rounded-full bg-[#D4A574]/20 flex items-center justify-center"><div className="h-1.5 w-1.5 rounded-full bg-[#D4A574]" /></div>
              <div className="text-sm leading-relaxed min-w-0 prose prose-sm prose-invert max-w-none [&_pre]:bg-overlay/[0.08] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_code]:text-xs [&_code]:bg-overlay/[0.08] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
              </div>
            </div>
          )
          if (msg.role === 'tool') return <div key={msg.id} className="flex items-center gap-1.5 text-xs text-muted-foreground/70 pl-6"><Wrench className="h-3 w-3" /><span>{msg.content}</span></div>
          return <div key={msg.id} className="text-xs text-destructive/80 px-1">{msg.content}</div>
        })}

        {sending && (
          <div className="flex items-center gap-2">
            <ClaudeLogo />
            <span className="text-sm text-[#D97757] animate-pulse">{thinkingWord}</span>
            {firstMessage && <span className="text-[10px] text-muted-foreground/50">首次初始化中...</span>}
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
              <ActionItem icon={<RotateCcw className="h-3.5 w-3.5" />} label="清空对话" onClick={() => { setShowActions(false); handleNewSession() }} />

              <div className="h-px bg-overlay/[0.06] my-1" />
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Model</div>
              <ActionItem icon={<Cpu className="h-3.5 w-3.5" />} label="切换模型..." onClick={() => { setShowActions(false); setInput('/model '); inputRef.current?.focus() }} />
              <ActionItem icon={<Zap className="h-3.5 w-3.5" />} label="切换快速模式" onClick={() => { setShowActions(false); sendSlashCommand('/fast') }} />
              <ActionItem icon={<Brain className="h-3.5 w-3.5" />} label="花费统计" onClick={() => { setShowActions(false); sendSlashCommand('/cost') }} />
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
                { cmd: '/compact', desc: '压缩上下文' },
                { cmd: '/cost', desc: '查看花费统计' },
                { cmd: '/model sonnet', desc: '切换到 Sonnet' },
                { cmd: '/model opus', desc: '切换到 Opus' },
                { cmd: '/model haiku', desc: '切换到 Haiku' },
                { cmd: '/fast', desc: '切换快速模式' },
                { cmd: '/help', desc: '帮助' },
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
            placeholder="描述你的需求..."
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

function ClaudeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 49" fill="none" className="shrink-0">
      <path d="M23.15 45.53l.66-2.91.75-3.76.61-3.01.57-3.71.33-1.22-.05-.1-.23.05-2.82 3.85-4.28 5.78-3.38 3.57-.8.33-1.41-.7.14-1.32.8-1.13 4.65-5.97 2.82-3.71 1.83-2.12-.05-.28h-.09L10.79 37.25l-2.21.28-1-.89.15-1.46.47-.47 3.71-2.58 9.26-5.17.14-.47-.14-.24h-.47l-1.55-.09-5.26-.14-4.56-.19-4.47-.24-1.13-.23-1.03-1.41.09-.71.94-.61 1.36.09 2.96.24 4.47.28 3.24.19 4.8.52h.75l.09-.33-.24-.19-.19-.19-4.65-3.1-4.98-3.29-2.63-1.93-1.41-.99-.7-.89-.29-1.97 1.27-1.41 1.74.14.42.09 1.74 1.36 3.71 2.87 4.89 3.62.7.56.33-.19v-.14l-.33-.52-2.63-4.79-2.82-4.89-1.27-2.02-.33-1.22c-.13-.42-.19-.89-.19-1.41l1.46-1.97.8-.28 1.97.28.8.7 1.22 2.77 1.93 4.37 3.05 5.92.9 1.79.47 1.6.19.52h.33v-.28l.24-3.38.47-4.09.47-5.26.14-1.5.75-1.79 1.46-.94 1.13.52.94 1.36-.14.85-.52 3.62-1.13 5.69-.7 3.85h.42l.47-.52 1.93-2.54 3.24-4.04 1.41-1.6 1.69-1.79 1.08-.85h2.02l1.46 2.21-.66 2.3-2.07 2.63-1.74 2.21-2.49 3.34-1.5 2.68.14.19h.33l5.59-1.22 3.05-.52 3.57-.61 1.65.75.19.75-.66 1.6-3.85.94-4.51.89-6.72 1.6-.09.05.09.14 3.01.28 1.32.09h3.19l5.92.42 1.55 1.03.9 1.22-.14.99-2.4 1.18-3.19-.75-7.52-1.79-2.54-.61h-.38v.19l2.16 2.12 3.9 3.52 4.94 4.56.24 1.13-.61.94-.66-.09-4.32-3.29-1.69-1.46-3.76-3.15h-.24v.33l.85 1.27 4.61 6.91.24 2.12-.33.66-1.22.42-1.27-.24-2.73-3.76-2.77-4.28-2.26-3.81-.24.19-1.36 14.19-.61.71-1.41.56-1.18-.89-.66-1.46z" fill="#D97757" />
    </svg>
  )
}
