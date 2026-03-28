import { useMemo } from 'react'

interface Props {
  code: string
  className?: string
}

interface Token {
  text: string
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'bracket' | 'plain'
}

/** 轻量 JSON 语法高亮（纯 React 渲染，安全无 XSS 风险） */
export function JsonHighlight({ code, className }: Props) {
  const tokens = useMemo(() => tokenize(code), [code])
  return (
    <pre className={`text-xs font-mono whitespace-pre-wrap break-all ${className ?? ''}`}>
      {tokens.map((t, i) => {
        const color = TOKEN_COLORS[t.type]
        return color ? <span key={i} className={color}>{t.text}</span> : <span key={i}>{t.text}</span>
      })}
    </pre>
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

function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  const re = /("(?:\\.|[^"\\])*")\s*(:)?|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index), type: 'plain' })
    }

    const [full, str, colon, bool, nul, num, bracket] = match
    if (str) {
      if (colon) {
        tokens.push({ text: str, type: 'key' })
        tokens.push({ text: colon, type: 'plain' })
      } else {
        tokens.push({ text: str, type: 'string' })
      }
    } else if (bool) {
      tokens.push({ text: full, type: 'boolean' })
    } else if (nul) {
      tokens.push({ text: full, type: 'null' })
    } else if (num) {
      tokens.push({ text: full, type: 'number' })
    } else if (bracket) {
      tokens.push({ text: full, type: 'bracket' })
    }

    lastIndex = re.lastIndex
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: 'plain' })
  }

  return tokens
}

export default JsonHighlight
