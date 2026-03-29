import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Send, Loader2, Trash2, X, FolderSearch, Play, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAIStore, type ChatMessage } from '@/stores/ai-store'

export default function AIPanel() {
  const { t } = useTranslation()
  const { open, messages, sending, sendMessage, clearMessages, setOpen } = useAIStore()
  const QUICK_ACTIONS = [
    { icon: FolderSearch, label: t('ai.scan_code'), prompt: 'Please analyze the following code and generate API test cases.' },
    { icon: ListChecks, label: t('ai.suggest_assertions'), prompt: 'Please suggest appropriate assertions for this API response.' },
    { icon: Play, label: t('ai.analyze_results'), prompt: 'Please analyze the test results and suggest fixes.' },
  ]
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleQuickAction = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col bg-sidebar h-full">
      {/* 顶部拖拽区域 */}
      <div className="h-8 shrink-0" data-tauri-drag-region="" />

      {/* 头部 */}
      <div className="flex items-center gap-2 h-10 px-4 border-b border-overlay/[0.06] shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium flex-1">AI 助手</span>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={clearMessages}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setOpen(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-5 pt-6">
            <div className="text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-overlay/[0.04] border border-overlay/[0.06] mx-auto mb-3">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">AI 助手</p>
              <p className="text-xs text-muted-foreground mt-1">帮你生成、管理和执行测试用例</p>
            </div>
            <div className="space-y-1.5 pt-1">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-left text-[13px] text-foreground/60 hover:bg-overlay/[0.04] hover:text-foreground border border-transparent hover:border-overlay/[0.06] transition-all duration-200 cursor-pointer"
                  onClick={() => handleQuickAction(action.prompt)}
                >
                  <action.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-overlay/[0.06] p-3 shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的需求..."
            rows={2}
            className="w-full resize-none rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3.5 py-2.5 pr-10 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 transition-all duration-200"
          />
          <button
            className={`absolute right-2.5 bottom-2.5 p-1.5 rounded-lg cursor-pointer transition-all duration-200 ${
              input.trim() && !sending
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/20'
            }`}
            onClick={handleSend}
            disabled={!input.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/30 mt-1.5 px-1">Enter 发送，Shift+Enter 换行</p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
        isUser
          ? 'btn-gradient text-primary-foreground'
          : 'glass-card'
      }`}>
        {message.loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">思考中...</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        )}
      </div>
    </div>
  )
}
