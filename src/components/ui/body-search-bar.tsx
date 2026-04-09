import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

/** 响应体搜索状态管理 hook，支持 ⌘F / Ctrl+F 快捷键 */
export function useBodySearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)

  const matchCountRef = useRef(0)
  const hoveredRef = useRef(false)
  const [, startTransition] = useTransition()

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => {
    setIsOpen(false)
    setTerm('')
    setActiveIndex(0)
    setMatchCount(0)
    matchCountRef.current = 0
  }, [])
  const updateTerm = useCallback((t: string) => {
    // 搜索高亮渲染量大，用 transition 避免阻塞输入
    startTransition(() => {
      setTerm(t)
      setActiveIndex(0)
    })
  }, [startTransition])
  const handleMatchCount = useCallback((count: number) => {
    matchCountRef.current = count
    setMatchCount(count)
    setActiveIndex((prev) => (count > 0 ? Math.min(prev, count - 1) : 0))
  }, [])
  const next = useCallback(() => {
    const mc = matchCountRef.current
    if (mc > 0) setActiveIndex((i) => (i + 1) % mc)
  }, [])
  const prev = useCallback(() => {
    const mc = matchCountRef.current
    if (mc > 0) setActiveIndex((i) => (i - 1 + mc) % mc)
  }, [])

  // ⌘F / Ctrl+F 快捷键（capture 阶段拦截浏览器默认行为）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && hoveredRef.current) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(true)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])

  /** 绑定到响应体容器，追踪悬停状态 */
  const containerHandlers = {
    onMouseEnter: () => { hoveredRef.current = true },
    onMouseLeave: () => { hoveredRef.current = false },
  }

  return { isOpen, term, matchCount, activeIndex, open, close, updateTerm, handleMatchCount, next, prev, containerHandlers }
}

interface SearchBarProps {
  matchCount: number
  activeIndex: number
  onSearch: (term: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/** 紧凑型内联搜索栏（Enter 搜索/下一个，Shift+Enter 上一个，Esc 关闭） */
export function BodySearchBar({ matchCount, activeIndex, onSearch, onNext, onPrev, onClose }: SearchBarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  /** 已提交的搜索词（state 驱动渲染，用于显示匹配计数） */
  const [committed, setCommitted] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (committed !== value) {
        setCommitted(value)
        onSearch(value)
      } else {
        e.shiftKey ? onPrev() : onNext()
      }
    }
  }

  return (
    <div className="flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-lg bg-background/95 backdrop-blur-sm border border-overlay/[0.10] shadow-lg">
      <Search className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={t('response.search_placeholder')}
        className="bg-transparent text-[11px] outline-none w-24 placeholder:text-muted-foreground/40 px-1"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {committed && (
        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0 mr-0.5">
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : '0'}
        </span>
      )}
      <button
        type="button"
        onClick={onPrev}
        className="p-0.5 rounded hover:bg-overlay/[0.06] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
        aria-label="Previous match"
        disabled={matchCount === 0}
      >
        <ChevronUp className="h-2.5 w-2.5" />
      </button>
      <button
        type="button"
        onClick={onNext}
        className="p-0.5 rounded hover:bg-overlay/[0.06] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
        aria-label="Next match"
        disabled={matchCount === 0}
      >
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-0.5 rounded hover:bg-overlay/[0.06] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer transition-colors"
        aria-label="Close search"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}
