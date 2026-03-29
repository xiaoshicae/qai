import { useMemo } from 'react'
import { tokenize, TOKEN_COLORS } from '@/lib/syntax'

interface Props {
  code: string
  className?: string
}

/** 轻量 JSON 语法高亮（纯 React 渲染，安全无 XSS 风险） */
export function JsonHighlight({ code, className }: Props) {
  const tokens = useMemo(() => tokenize(code), [code])
  return (
    <pre className={`text-xs font-mono whitespace-pre overflow-x-auto ${className ?? ''}`}>
      {tokens.map((t, i) => {
        const color = TOKEN_COLORS[t.type]
        return color ? <span key={i} className={color}>{t.text}</span> : <span key={i}>{t.text}</span>
      })}
    </pre>
  )
}

export default JsonHighlight
