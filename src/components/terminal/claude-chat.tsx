import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Wrench, ChevronRight, Terminal, FileText, FileEdit, Search, Globe } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { useClaudeStore, type ClaudeTab } from '@/stores/claude-store'

const THINKING_WORDS = ['Thinking...', 'Pondering...', 'Analyzing...', 'Reasoning...', 'Frolicking...']

interface Props {
  tabId: string
}

export default function ClaudeChat({ tabId }: Props) {
  const { t } = useTranslation()
  const tab = useClaudeStore((s) => s.tabs.find((t) => t.id === tabId)) as ClaudeTab | undefined
  const cliStatus = useClaudeStore((s) => s.cliStatus)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [thinkingWord, setThinkingWord] = useState('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [tab?.messages, tab?.sending])

  useEffect(() => {
    if (!tab?.sending) return
    setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
    const interval = setInterval(() => {
      setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
    }, 3000)
    return () => clearInterval(interval)
  }, [tab?.sending])

  if (!tab) return null

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 select-text">
      {/* CLI 未安装/未认证引导 */}
      {cliStatus !== 'ready' && cliStatus !== 'checking' && (
        <CliGuide cliStatus={cliStatus} />
      )}

      {cliStatus === 'checking' && (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="h-12 w-12 rounded-2xl bg-overlay/[0.04] border border-overlay/[0.06] flex items-center justify-center">
            <ClaudeLogo size={24} />
          </div>
          <p className="text-xs text-muted-foreground mt-3 animate-pulse">{t('claude.checking_cli')}</p>
        </div>
      )}

      {cliStatus === 'ready' && tab.messages.length === 0 && !tab.sending && (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="h-12 w-12 rounded-2xl bg-overlay/[0.04] border border-overlay/[0.06] flex items-center justify-center">
            <ClaudeLogo size={24} />
          </div>
          <p className="text-sm font-medium mt-3">Claude Code</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
            {tab.warmupStatus === 'warming' ? t('claude.warming_hint') : tab.warmupStatus === 'ready' ? t('claude.ready') : t('claude.first_msg')}
          </p>
        </div>
      )}

      {tab.messages.map((msg) => {
        if (msg.role === 'user') return (
          <div key={msg.id} className="rounded-xl border border-overlay/[0.08] bg-overlay/[0.04] px-3.5 py-2.5 text-sm">
            {msg.content}
          </div>
        )
        if (msg.role === 'assistant') return (
          <div key={msg.id} className="flex gap-2.5">
            <div className="shrink-0 mt-1"><ClaudeLogo size={14} /></div>
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

      {tab.sending && (
        <div className="flex items-center gap-2.5 ml-0.5">
          <ClaudeLogo />
          <span className="text-sm text-[#D97757] animate-pulse">{thinkingWord}</span>
          {tab.messages.length === 0 && tab.warmupStatus !== 'ready' && (
            <span className="text-[10px] text-muted-foreground/50">{t('claude.first_init')}</span>
          )}
        </div>
      )}
    </div>
  )
}

function CliGuide({ cliStatus }: { cliStatus: string }) {
  const { t } = useTranslation()
  const setCliStatus = useClaudeStore((s) => s.setCliStatus)

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="h-12 w-12 rounded-2xl bg-overlay/[0.04] border border-overlay/[0.06] flex items-center justify-center">
        <ClaudeLogo size={24} />
      </div>
      <p className="text-sm font-medium mt-3">Claude Code</p>
      {cliStatus === 'not_installed' ? (
        <>
          <p className="text-xs text-muted-foreground mt-2 max-w-[280px] leading-relaxed">{t('claude.cli_not_installed')}</p>
          <a href="https://docs.anthropic.com/en/docs/claude-code/overview" target="_blank" rel="noopener noreferrer"
            className="mt-3 text-xs text-primary hover:underline">{t('claude.install_guide')} →</a>
          <code className="mt-2 text-[11px] bg-overlay/[0.06] border border-overlay/[0.06] rounded-lg px-3 py-1.5 font-mono text-muted-foreground">
            npm install -g @anthropic-ai/claude-code
          </code>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mt-2 max-w-[280px] leading-relaxed">{t('claude.cli_not_authenticated')}</p>
          <code className="mt-3 text-[11px] bg-overlay/[0.06] border border-overlay/[0.06] rounded-lg px-3 py-1.5 font-mono text-muted-foreground">
            claude login
          </code>
        </>
      )}
      <button
        onClick={() => { setCliStatus('checking'); setTimeout(() => { invoke<{ status: string }>('claude_check_status').then((res) => setCliStatus(res.status as 'ready' | 'not_installed' | 'not_authenticated')).catch(() => setCliStatus('not_installed')) }, 500) }}
        className="mt-4 text-xs text-primary/70 hover:text-primary transition-colors cursor-pointer"
      >{t('claude.retry_check')}</button>
    </div>
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

export function ClaudeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 49" fill="none" className="shrink-0">
      <path d="M23.15 45.53l.66-2.91.75-3.76.61-3.01.57-3.71.33-1.22-.05-.1-.23.05-2.82 3.85-4.28 5.78-3.38 3.57-.8.33-1.41-.7.14-1.32.8-1.13 4.65-5.97 2.82-3.71 1.83-2.12-.05-.28h-.09L10.79 37.25l-2.21.28-1-.89.15-1.46.47-.47 3.71-2.58 9.26-5.17.14-.47-.14-.24h-.47l-1.55-.09-5.26-.14-4.56-.19-4.47-.24-1.13-.23-1.03-1.41.09-.71.94-.61 1.36.09 2.96.24 4.47.28 3.24.19 4.8.52h.75l.09-.33-.24-.19-.19-.19-4.65-3.1-4.98-3.29-2.63-1.93-1.41-.99-.7-.89-.29-1.97 1.27-1.41 1.74.14.42.09 1.74 1.36 3.71 2.87 4.89 3.62.7.56.33-.19v-.14l-.33-.52-2.63-4.79-2.82-4.89-1.27-2.02-.33-1.22c-.13-.42-.19-.89-.19-1.41l1.46-1.97.8-.28 1.97.28.8.7 1.22 2.77 1.93 4.37 3.05 5.92.9 1.79.47 1.6.19.52h.33v-.28l.24-3.38.47-4.09.47-5.26.14-1.5.75-1.79 1.46-.94 1.13.52.94 1.36-.14.85-.52 3.62-1.13 5.69-.7 3.85h.42l.47-.52 1.93-2.54 3.24-4.04 1.41-1.6 1.69-1.79 1.08-.85h2.02l1.46 2.21-.66 2.3-2.07 2.63-1.74 2.21-2.49 3.34-1.5 2.68.14.19h.33l5.59-1.22 3.05-.52 3.57-.61 1.65.75.19.75-.66 1.6-3.85.94-4.51.89-6.72 1.6-.09.05.09.14 3.01.28 1.32.09h3.19l5.92.42 1.55 1.03.9 1.22-.14.99-2.4 1.18-3.19-.75-7.52-1.79-2.54-.61h-.38v.19l2.16 2.12 3.9 3.52 4.94 4.56.24 1.13-.61.94-.66-.09-4.32-3.29-1.69-1.46-3.76-3.15h-.24v.33l.85 1.27 4.61 6.91.24 2.12-.33.66-1.22.42-1.27-.24-2.73-3.76-2.77-4.28-2.26-3.81-.24.19-1.36 14.19-.61.71-1.41.56-1.18-.89-.66-1.46z" fill="#D97757" />
    </svg>
  )
}
