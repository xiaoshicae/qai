import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, Loader2, Trash2, X, FolderSearch, Play, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAIStore, type ChatMessage } from '@/stores/ai-store'

const QUICK_ACTIONS = [
  { icon: FolderSearch, label: '扫描代码生成用例', prompt: '请分析以下代码并生成 API 测试用例。我会提供代码内容。' },
  { icon: ListChecks, label: '建议断言规则', prompt: '请根据以下 API 响应建议合适的断言规则。我会提供响应体。' },
  { icon: Play, label: '分析测试结果', prompt: '请分析以下测试执行结果，找出问题并提供修复建议。' },
]

export default function AIPanel() {
  const { open, messages, sending, sendMessage, clearMessages, setOpen } = useAIStore()
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
    <div className="flex flex-col bg-background h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 h-12 px-4 border-b border-border shrink-0">
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
          <div className="space-y-4 pt-8">
            <div className="text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted mx-auto mb-3">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">AI 助手</p>
              <p className="text-xs text-muted-foreground mt-1">帮你生成、管理和执行测试用例</p>
            </div>
            <div className="space-y-1.5 pt-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-left text-[13px] text-foreground/70 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
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
      <div className="border-t border-border p-3 shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的需求..."
            rows={2}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 pr-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <button
            className={`absolute right-2.5 bottom-2.5 p-1 rounded-md cursor-pointer transition-colors ${
              input.trim() && !sending
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/30'
            }`}
            onClick={handleSend}
            disabled={!input.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 px-1">Enter 发送，Shift+Enter 换行</p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-card ring-1 ring-foreground/10'
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
