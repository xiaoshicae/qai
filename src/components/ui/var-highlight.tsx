import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface Props {
  text: string
  vars?: Record<string, string>       // 环境变量（已解析）
  chainVars?: Set<string>              // 链式步骤提取的变量名集合
  className?: string
}

/** 高亮 {{variable}} 模板变量，三种状态区分显示 */
export function VarHighlight({ text, vars = {}, chainVars, className }: Props) {
  const parts = useMemo(() => splitVars(text), [text])

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.isVar ? (
          <VarTag key={i} name={p.text} value={vars[p.text]} isChainVar={chainVars?.has(p.text)} />
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

function VarTag({ name, value, isChainVar }: { name: string; value?: string; isChainVar?: boolean }) {
  const { t } = useTranslation()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const resolved = value !== undefined

  const style = resolved
    ? 'text-cyan-600 dark:text-cyan-400'
    : isChainVar
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground/60'

  const tooltip = resolved
    ? value
    : isChainVar
    ? t('common.var_chain_hint')
    : t('common.var_undefined')

  const handleEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 4 })
  }

  return (
    <span
      className="inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setPos(null)}
    >
      <span className={`cursor-help font-medium ${style}`}>
        {`{{${name}}}`}
      </span>
      {pos && createPortal(
        <span
          className="fixed z-[9999] px-2 py-1 rounded-lg text-[10px] font-mono bg-card border border-overlay/[0.1] shadow-2xl whitespace-nowrap max-w-xs truncate pointer-events-none"
          style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
        >
          <span className="text-muted-foreground">{name} = </span>
          <span className={resolved ? 'text-foreground' : isChainVar ? 'text-amber-600 dark:text-amber-400 italic' : 'text-muted-foreground italic'}>
            {tooltip}
          </span>
        </span>,
        document.body
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
