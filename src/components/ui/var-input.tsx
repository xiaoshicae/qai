import { useRef, useCallback, useState } from 'react'
import { VarHighlight } from './var-highlight'

interface VarInputProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  envVars?: Record<string, string>
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/**
 * 带变量高亮的输入框
 * 未聚焦：显示 VarHighlight（带 hover tooltip）
 * 聚焦：显示透明文字 input + 高亮 overlay
 */
export function VarInput({ value, onChange, onBlur, placeholder, className = '', envVars = {} }: VarInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const hasVars = value.includes('{{')

  const syncScroll = useCallback(() => {
    if (inputRef.current) setScrollLeft(inputRef.current.scrollLeft)
  }, [])

  const handleFocus = () => { setFocused(true); syncScroll() }
  const handleBlur = () => { setFocused(false); onBlur?.() }

  const segments = hasVars ? splitVarSegments(value, envVars) : null

  // 未聚焦且有变量时：显示 VarHighlight（带 tooltip）
  if (hasVars && !focused) {
    return (
      <div className="flex-1 min-w-0">
        <div
          className={`h-8 rounded-lg border border-overlay/[0.08] bg-transparent px-3 text-sm leading-8 overflow-hidden whitespace-nowrap cursor-text transition-colors hover:border-overlay/[0.12] ${className}`}
          style={{ fontFamily: MONO }}
          onClick={() => { setFocused(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
        >
          <VarHighlight text={value} vars={envVars} />
        </div>
        {/* 隐藏 input 保持 ref 可用 */}
        <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" tabIndex={-1} />
        {/* 解析预览行 */}
        {segments?.some((s) => s.type === 'var' && s.resolved) && (
          <div className="text-[10px] text-muted-foreground/50 truncate font-mono mt-0.5 px-1">
            {value.replace(/\{\{(\w+)\}\}/g, (m, key) => envVars[key] ?? m)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="relative">
        {/* 高亮层 */}
        {segments && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-lg" aria-hidden>
            <div
              ref={mirrorRef}
              className="h-8 px-3 whitespace-pre text-sm leading-8"
              style={{ fontFamily: MONO, transform: `translateX(-${scrollLeft}px)` }}
            >
              {segments.map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i} className="text-foreground">{seg.text}</span>
                ) : (
                  <span
                    key={i}
                    className={`rounded-sm px-0.5 ${
                      seg.resolved
                        ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                        : 'bg-red-500/15 text-red-500'
                    }`}
                  >
                    {seg.text}
                  </span>
                )
              )}
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); syncScroll() }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onScroll={syncScroll}
          onKeyUp={syncScroll}
          onClick={syncScroll}
          placeholder={placeholder}
          className={`w-full h-8 rounded-lg border border-overlay/[0.08] bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 ${
            hasVars ? 'text-transparent caret-foreground selection:bg-primary/20' : ''
          } ${className}`}
          style={{ fontFamily: MONO }}
        />
      </div>
      {/* 解析预览行 */}
      {hasVars && segments?.some((s) => s.type === 'var' && s.resolved) && (
        <div className="text-[10px] text-muted-foreground/50 truncate font-mono mt-0.5 px-1">
          {value.replace(/\{\{(\w+)\}\}/g, (m, key) => envVars[key] ?? m)}
        </div>
      )}
    </div>
  )
}

interface Segment { type: 'text' | 'var'; text: string; varName?: string; resolved?: boolean; resolvedValue?: string }

function splitVarSegments(text: string, vars: Record<string, string>): Segment[] {
  const segments: Segment[] = []
  const regex = /\{\{(\w+)\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    const varName = match[1]
    const resolved = varName in vars
    segments.push({ type: 'var', text: match[0], varName, resolved, resolvedValue: resolved ? vars[varName] : undefined })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) })
  return segments
}
