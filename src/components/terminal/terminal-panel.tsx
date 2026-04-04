import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, X, ArrowUp, Square, RotateCcw, Cpu, Zap, Brain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useClaudeStore } from '@/stores/claude-store'
import ClaudeChat, { ClaudeLogo } from './claude-chat'
import { cn } from '@/lib/utils'

interface Props {
  onClose: () => void
}

export default function TerminalPanel({ onClose }: Props) {
  const { t } = useTranslation()
  const store = useClaudeStore()
  const activeTab = store.activeTab()
  const [input, setInput] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { store.init() }, [])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !activeTab || activeTab.sending) return
    setInput('')

    // 自动命名：仅在标题还是默认 "New Chat" 时
    if (activeTab.title === 'New Chat') {
      const title = text.slice(0, 20) + (text.length > 20 ? '...' : '')
      set_tab_title(activeTab.id, title)
    }

    store.appendMessage(activeTab.id, { id: crypto.randomUUID(), role: 'user', content: text })
    store.setSending(activeTab.id, true)

    try {
      await invoke('claude_send', {
        message: text,
        mcpConfigPath: store.mcpConfigPath,
        sessionId: activeTab.claudeSessionId,
      })
    } catch (e: any) {
      store.appendMessage(activeTab.id, { id: crypto.randomUUID(), role: 'system', content: `${e}` })
      store.setSending(activeTab.id, false)
    }
  }

  const handleStop = () => {
    invoke('claude_stop').catch(() => {})
    if (activeTab) store.setSending(activeTab.id, false)
  }

  const sendSlashCommand = async (cmd: string) => {
    if (!activeTab || activeTab.sending) return
    store.appendMessage(activeTab.id, { id: crypto.randomUUID(), role: 'user', content: cmd })
    store.setSending(activeTab.id, true)
    try {
      await invoke('claude_send', {
        message: cmd,
        mcpConfigPath: store.mcpConfigPath,
        sessionId: activeTab.claudeSessionId,
      })
    } catch (e: any) {
      store.appendMessage(activeTab.id, { id: crypto.randomUUID(), role: 'system', content: `${e}` })
      store.setSending(activeTab.id, false)
    }
  }

  const handleNewTab = async () => {
    const tabId = store.createTab()
    if (tabId === store.activeTabId && store.tabs.length >= 8) return
    inputRef.current?.focus()

    // 尝试取备用 session（秒级）
    try {
      const spare = await invoke<string | null>('claude_take_spare')
      if (spare) {
        store.setClaudeSessionId(tabId, spare)
        store.setWarmupStatus(tabId, 'ready')
        // 后台补充备用 session
        invoke('claude_warmup_spare', { mcpConfigPath: store.mcpConfigPath }).catch(() => {})
        return
      }
    } catch {
      // No spare session available, continue to cold start
    }

    // 没有备用 session，走冷启动
    store.setWarmupStatus(tabId, 'warming')
    try {
      invoke('claude_reset_session').catch(() => {})
      await invoke('claude_warmup', { mcpConfigPath: store.mcpConfigPath })
      store.setWarmupStatus(tabId, 'ready')
      // 预热下一个备用
      invoke('claude_warmup_spare', { mcpConfigPath: store.mcpConfigPath }).catch(() => {})
    } catch {
      store.setWarmupStatus(tabId, 'idle')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
  }

  // 辅助：更新 tab title（store 里 updateTab 是内部的，这里直接用 set）
  function set_tab_title(tabId: string, title: string) {
    useClaudeStore.setState((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, title } : t),
    }))
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-overlay/[0.08] shrink-0" data-tauri-drag-region="">
        <div className="flex items-center gap-2">
          <ClaudeLogo />
          <span className="text-xs font-medium">Claude Code</span>
          {activeTab?.warmupStatus === 'warming' && <span className="text-[9px] text-warning animate-pulse">{t('claude.warming_up')}</span>}
          {activeTab?.warmupStatus === 'ready' && store.mcpConfigPath && <span className="text-[9px] text-success font-medium">MCP</span>}
          {activeTab?.warmupStatus === 'ready' && !store.mcpConfigPath && <span className="text-[9px] text-success">{t('claude.warmed_up')}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClose} className="p-1 rounded hover:bg-overlay/[0.06] cursor-pointer transition-colors" title={t('common.close')}>
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Tab 栏 */}
      {store.tabs.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-overlay/[0.06] overflow-x-auto shrink-0">
          {store.tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => store.switchTab(tab.id)}
              onDoubleClick={() => { setRenamingTabId(tab.id); setRenameValue(tab.title); setTimeout(() => renameRef.current?.select(), 0) }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] whitespace-nowrap transition-all group max-w-[140px]',
                tab.id === store.activeTabId
                  ? 'bg-overlay/[0.08] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'
              )}
            >
              {renamingTabId === tab.id ? (
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => { if (renameValue.trim()) set_tab_title(tab.id, renameValue.trim()); setRenamingTabId(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { setRenamingTabId(null) } }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent outline-none text-[11px] w-[80px] border-b border-primary/40"
                />
              ) : (
                <span className="truncate">{tab.title}</span>
              )}
              {tab.sending && <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse shrink-0" />}
              {store.tabs.length > 1 && renamingTabId !== tab.id && (
                <X
                  className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); store.closeTab(tab.id) }}
                />
              )}
            </button>
          ))}
          <button
            onClick={handleNewTab}
            className="p-1 rounded-md hover:bg-overlay/[0.06] text-muted-foreground cursor-pointer transition-colors shrink-0"
            title={t('claude.new_chat')}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 消息区域 */}
      {activeTab && <ClaudeChat tabId={activeTab.id} />}

      {/* + 操作菜单 */}
      {showActions && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
          <div className="relative z-50 mx-3 mb-1 rounded-xl border border-overlay/[0.1] bg-background shadow-2xl overflow-hidden">
            <div className="py-1">
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Context</div>
              <ActionItem icon={<RotateCcw className="h-3.5 w-3.5" />} label={t('claude.clear')} onClick={() => { setShowActions(false); if (activeTab) { useClaudeStore.setState((s) => ({ tabs: s.tabs.map((t) => t.id === activeTab.id ? { ...t, messages: [] } : t) })) } }} />
              <div className="h-px bg-overlay/[0.06] my-1" />
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Model</div>
              <ActionItem icon={<Cpu className="h-3.5 w-3.5" />} label="Opus" onClick={() => { setShowActions(false); sendSlashCommand('/model opus') }} />
              <ActionItem icon={<Cpu className="h-3.5 w-3.5" />} label="Sonnet" onClick={() => { setShowActions(false); sendSlashCommand('/model sonnet') }} />
              <ActionItem icon={<Cpu className="h-3.5 w-3.5" />} label="Haiku" onClick={() => { setShowActions(false); sendSlashCommand('/model haiku') }} />
              <div className="h-px bg-overlay/[0.06] my-1" />
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase">Session</div>
              <ActionItem icon={<Zap className="h-3.5 w-3.5" />} label={t('claude.fast_mode')} onClick={() => { setShowActions(false); sendSlashCommand('/fast') }} />
              <ActionItem icon={<Brain className="h-3.5 w-3.5" />} label={t('claude.cost')} onClick={() => { setShowActions(false); sendSlashCommand('/cost') }} />
              <ActionItem icon={<RotateCcw className="h-3.5 w-3.5" />} label={t('claude.slash_compact')} onClick={() => { setShowActions(false); sendSlashCommand('/compact') }} />
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
            disabled={activeTab?.sending || store.cliStatus !== 'ready'}
            className="w-full px-3 py-2 pr-12 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/40 max-h-32 overflow-y-auto disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <div className="flex items-center gap-0.5">
              <button onClick={() => setShowActions(!showActions)} className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-overlay/[0.06] cursor-pointer transition-colors" title="操作菜单">
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/30">⌘↵</span>
              {activeTab?.sending ? (
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

function ActionItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs hover:bg-overlay/[0.04] cursor-pointer transition-colors">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}
