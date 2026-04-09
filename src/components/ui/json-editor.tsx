import { useRef, useMemo, useCallback, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { tokenize, TOKEN_COLORS } from '@/lib/syntax'

interface Props {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

/** JSON 编辑器：语法高亮 + 实时校验 */
export function JsonEditor({ value, onChange, className, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [focused, setFocused] = useState(false)

  const jsonError = useMemo(() => {
    if (!value.trim()) return null
    try { JSON.parse(value); return null }
    catch (e: unknown) { return e instanceof Error ? e.message : String(e) }
  }, [value])

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop
      preRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = value.substring(0, start) + '  ' + value.substring(end)
      onChange(newVal)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  const tokens = useMemo(() => tokenize(value), [value])

  return (
    <div className={`relative ${className ?? ''}`}>
      <pre
        ref={preRef}
        className="absolute inset-0 px-3 py-2 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words overflow-hidden pointer-events-none border border-transparent"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', wordBreak: 'break-word', overflowWrap: 'break-word', tabSize: 2 }}
        aria-hidden="true"
      >
        {tokens.map((t, i) => {
          const color = TOKEN_COLORS[t.type]
          return color ? <span key={i} className={color}>{t.text}</span> : <span key={i}>{t.text}</span>
        })}
        {'\n'}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        placeholder={placeholder}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', color: 'transparent', caretColor: 'var(--color-foreground)', wordBreak: 'break-word', overflowWrap: 'break-word', tabSize: 2 }}
        className={`relative w-full h-full min-h-0 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap resize-none outline-none bg-transparent z-10 rounded-xl border transition-all duration-200 ${
          jsonError && value.trim()
            ? 'border-red-500/50 hover:border-red-500/70'
            : focused
              ? 'border-primary/50 ring-2 ring-primary/20'
              : 'border-overlay/[0.08] hover:border-overlay/[0.12]'
        }`}
      />
      {jsonError && value.trim() && (
        <div className="absolute bottom-1.5 left-2 right-2 flex items-start gap-1 px-2 py-1 rounded-md bg-red-500/10 text-[10px] text-red-400 z-20">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="truncate">{jsonError}</span>
        </div>
      )}
    </div>
  )
}

export default JsonEditor
