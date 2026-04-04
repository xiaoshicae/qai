import { useRef, useEffect, useState } from 'react'
import { MENU_CONTAINER_CLASS, MENU_ITEM_CLASS, MENU_DANGER_CLASS, MENU_DIVIDER_CLASS } from '@/lib/styles'

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}

/** 通用右键菜单容器：固定定位 + 点击外部关闭 + Escape关闭 + 视口边界检测 + 键盘导航 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 视口边界检测：菜单渲染后检查是否溢出，自动调整位置
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (x + rect.width > vw - 8) left = vw - rect.width - 8
    if (y + rect.height > vh - 8) top = vh - rect.height - 8
    if (left < 8) left = 8
    if (top < 8) top = 8
    if (left !== x || top !== y) setPos({ left, top })
  }, [x, y])

  // 点击外部 + Escape 关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        navigateItems(ref.current, e.key === 'ArrowDown' ? 1 : -1)
      }
      if (e.key === 'Enter') {
        const focused = ref.current?.querySelector('[data-menu-focus="true"]') as HTMLElement | null
        focused?.click()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`fixed z-50 min-w-[160px] ${MENU_CONTAINER_CLASS}`}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {children}
    </div>
  )
}

/** 键盘导航：在菜单内上下移动焦点 */
function navigateItems(container: HTMLElement | null, direction: 1 | -1) {
  if (!container) return
  const items = Array.from(container.querySelectorAll('button:not([disabled])')) as HTMLElement[]
  if (items.length === 0) return
  const current = items.findIndex((el) => el.getAttribute('data-menu-focus') === 'true')
  items.forEach((el) => el.removeAttribute('data-menu-focus'))
  let next = current + direction
  if (next < 0) next = items.length - 1
  if (next >= items.length) next = 0
  items[next].setAttribute('data-menu-focus', 'true')
  items[next].focus()
}

/** 菜单项样式常量 */
export const menuItemClass = MENU_ITEM_CLASS
export const menuDangerClass = MENU_DANGER_CLASS
export const menuDividerClass = MENU_DIVIDER_CLASS
