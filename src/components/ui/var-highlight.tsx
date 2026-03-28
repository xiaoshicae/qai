import { useMemo, useState } from 'react'

interface Props {
  text: string
  vars?: Record<string, string>
  className?: string
}

/** 高亮 {{variable}} 模板变量，hover 显示实际值 */
export function VarHighlight({ text, vars = {}, className }: Props) {
  const parts = useMemo(() => splitVars(text), [text])

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.isVar ? (
          <VarTag key={i} name={p.text} value={vars[p.text]} />
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

function VarTag({ name, value }: { name: string; value?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const handleEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ x: rect.left, y: rect.bottom + 4 })
  }

  return (
    <span
      className="inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setPos(null)}
    >
      <span className="text-cyan-400 bg-cyan-500/10 rounded px-0.5 cursor-help">
        {`{{${name}}}`}
      </span>
      {pos && (
        <span
          className="fixed z-[9999] px-2 py-1 rounded-lg text-[10px] font-mono bg-card border border-overlay/[0.1] shadow-lg whitespace-nowrap max-w-xs truncate"
          style={{ left: pos.x, top: pos.y }}
        >
          <span className="text-muted-foreground">{name} = </span>
          <span className="text-foreground">{value ?? <span className="text-red-400 italic">未定义</span>}</span>
        </span>
      )}
    </span>
  )
}

interface Part {
  text: string
  isVar: boolean
}

function splitVars(text: string): Part[] {
  const parts: Part[] = []
  const re = /\{\{(\w+)\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isVar: false })
    }
    parts.push({ text: match[1], isVar: true })
    lastIndex = re.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isVar: false })
  }

  return parts
}

export default VarHighlight
