import { useRef, useEffect } from 'react'

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}

/** 通用右键菜单容器：固定定位 + 点击外部关闭 + glass-card 样式 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-xl glass-card p-1.5 shadow-2xl text-xs"
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  )
}

/** 菜单项样式常量 */
export const menuItemClass = 'flex items-center gap-2 w-full px-3 py-2 rounded-lg cursor-pointer transition-colors text-left text-xs hover:bg-overlay/[0.06]'
export const menuDangerClass = 'flex items-center gap-2 w-full px-3 py-2 rounded-lg cursor-pointer transition-colors text-left text-xs text-destructive hover:bg-destructive/10'
export const menuDividerClass = 'h-px bg-overlay/[0.06] my-1'
