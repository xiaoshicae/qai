import { useMemo, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { tokenize, TOKEN_COLORS } from '@/lib/syntax'

interface Props {
  code: string
  className?: string
  /** 搜索关键词（大小写不敏感） */
  searchTerm?: string
  /** 当前高亮的匹配项索引 */
  activeMatchIndex?: number
  /** 匹配总数变化时回调 */
  onMatchCount?: (count: number) => void
}

/** 轻量 JSON 语法高亮（纯 React 渲染，安全无 XSS 风险），支持搜索高亮 */
export function JsonHighlight({ code, className, searchTerm, activeMatchIndex = -1, onMatchCount }: Props) {
  const tokens = useMemo(() => tokenize(code), [code])
  const containerRef = useRef<HTMLPreElement>(null)

  const { elements, matchCount } = useMemo(() => {
    if (!searchTerm) {
      return {
        elements: tokens.map((t, i) => {
          const color = TOKEN_COLORS[t.type]
          return color ? <span key={i} className={color}>{t.text}</span> : <span key={i}>{t.text}</span>
        }),
        matchCount: 0,
      }
    }

    const lowerSearch = searchTerm.toLowerCase()
    let globalIdx = 0
    const els: React.ReactNode[] = []

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti]
      const color = TOKEN_COLORS[token.type] || ''
      const text = token.text
      const lowerText = text.toLowerCase()

      let lastPos = 0
      let searchPos = lowerText.indexOf(lowerSearch, lastPos)

      if (searchPos === -1) {
        els.push(color ? <span key={`t${ti}`} className={color}>{text}</span> : <span key={`t${ti}`}>{text}</span>)
        continue
      }

      while (searchPos !== -1) {
        if (searchPos > lastPos) {
          const before = text.slice(lastPos, searchPos)
          els.push(color ? <span key={`t${ti}b${lastPos}`} className={color}>{before}</span> : <span key={`t${ti}b${lastPos}`}>{before}</span>)
        }
        const matchText = text.slice(searchPos, searchPos + searchTerm.length)
        const isActive = globalIdx === activeMatchIndex
        els.push(
          <mark
            key={`m${globalIdx}`}
            className={`rounded-sm px-px -mx-px ${isActive ? 'bg-amber-400 dark:bg-amber-500/80' : 'bg-amber-400/25 dark:bg-amber-500/20'}`}
            data-search-match={globalIdx}
          >
            <span className={isActive ? '' : color}>{matchText}</span>
          </mark>,
        )
        globalIdx++
        lastPos = searchPos + searchTerm.length
        searchPos = lowerText.indexOf(lowerSearch, lastPos)
      }
      if (lastPos < text.length) {
        const after = text.slice(lastPos)
        els.push(color ? <span key={`t${ti}a${lastPos}`} className={color}>{after}</span> : <span key={`t${ti}a${lastPos}`}>{after}</span>)
      }
    }

    return { elements: els, matchCount: globalIdx }
  }, [tokens, searchTerm, activeMatchIndex])

  // 报告匹配数
  useEffect(() => {
    onMatchCount?.(matchCount)
  }, [matchCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // 滚动到当前匹配项
  useEffect(() => {
    if (activeMatchIndex < 0 || !searchTerm || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-search-match="${activeMatchIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeMatchIndex, searchTerm])

  return (
    <pre ref={containerRef} className={cn('text-xs font-mono whitespace-pre overflow-x-auto', className)}>
      {elements}
    </pre>
  )
}

export default JsonHighlight
