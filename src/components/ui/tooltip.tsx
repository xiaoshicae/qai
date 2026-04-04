import { useState, useRef, useEffect, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  delay?: number
  side?: 'top' | 'bottom'
}

/** 轻量 Tooltip — 替代原生 title 属性，300ms 快速显示 */
export function Tooltip({ content, children, delay = 300, side = 'bottom' }: TooltipProps) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const enter = () => { timer.current = setTimeout(() => setShow(true), delay) }
  const leave = () => { clearTimeout(timer.current); setShow(false) }

  // 组件卸载时清理 timer，防止内存泄漏
  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  return (
    <div className="relative inline-flex" onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {show && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap pointer-events-none shadow-xl dark:bg-[oklch(0.25_0.005_260)] dark:text-[oklch(0.85_0.005_260)] bg-[oklch(0.2_0.005_260)] text-[oklch(0.92_0.005_260)] ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}>
          {content}
        </div>
      )}
    </div>
  )
}
