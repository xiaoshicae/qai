import { useRef, useMemo, useCallback, useState } from 'react'
import { AlertCircle } from 'lucide-react'

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
    catch (e: any) { return e.message as string }
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
        className="absolute inset-0 px-3 py-2 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all overflow-hidden pointer-events-none"
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
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', color: 'transparent', caretColor: 'var(--color-foreground)' }}
        className={`relative w-full h-full min-h-0 px-3 py-2 text-xs leading-relaxed resize-none outline-none bg-transparent z-10 rounded-xl border transition-all duration-200 ${
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

const TOKEN_COLORS: Record<string, string> = {
  key: 'text-sky-400',
  string: 'text-emerald-400',
  number: 'text-amber-400',
  boolean: 'text-purple-400',
  null: 'text-purple-400',
  bracket: 'text-muted-foreground/60',
}

interface Token {
  text: string
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'bracket' | 'plain'
}

function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  const re = /("(?:\\.|[^"\\])*")\s*(:)?|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    if (match.index > lastIndex) tokens.push({ text: code.slice(lastIndex, match.index), type: 'plain' })
    const [full, str, colon, bool, nul, num, bracket] = match
    if (str) { tokens.push({ text: str, type: colon ? 'key' : 'string' }); if (colon) tokens.push({ text: colon, type: 'plain' }) }
    else if (bool) tokens.push({ text: full, type: 'boolean' })
    else if (nul) tokens.push({ text: full, type: 'null' })
    else if (num) tokens.push({ text: full, type: 'number' })
    else if (bracket) tokens.push({ text: full, type: 'bracket' })
    lastIndex = re.lastIndex
  }
  if (lastIndex < code.length) tokens.push({ text: code.slice(lastIndex), type: 'plain' })
  return tokens
}

export default JsonEditor
