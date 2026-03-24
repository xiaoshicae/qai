import { useState, useCallback, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Sidebar from './sidebar'
import AIPanel from '@/components/ai/ai-panel'
import { useAIStore } from '@/stores/ai-store'

function useResizable(initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      setWidth(Math.min(max, Math.max(min, startW.current + delta)))
    }
    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, min, max])

  return { width, onMouseDown }
}

function useResizableRight(initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - ev.clientX
      setWidth(Math.min(max, Math.max(min, startW.current + delta)))
    }
    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, min, max])

  return { width, onMouseDown }
}

export default function AppLayout() {
  const { open, toggleOpen } = useAIStore()
  const sidebar = useResizable(280, 200, 450)
  const aiPanel = useResizableRight(380, 280, 600)

  return (
    <div className="flex h-screen bg-background">
      {/* 左侧边栏 */}
      <aside className="flex-shrink-0 overflow-hidden" style={{ width: sidebar.width }}>
        <Sidebar />
      </aside>
      {/* 左拖拽条 */}
      <div
        className="w-px bg-border hover:bg-primary/50 cursor-col-resize shrink-0 transition-colors"
        onMouseDown={sidebar.onMouseDown}
      />

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden bg-muted/30 relative min-w-[300px]">
        <Outlet />
        {!open && (
          <button
            className="absolute bottom-5 right-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 cursor-pointer transition-all active:translate-y-px"
            onClick={toggleOpen}
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI 助手</span>
          </button>
        )}
      </main>

      {/* 右拖拽条 */}
      {open && (
        <div
          className="w-px bg-border hover:bg-primary/50 cursor-col-resize shrink-0 transition-colors"
          onMouseDown={aiPanel.onMouseDown}
        />
      )}

      {/* AI 面板 */}
      {open && (
        <div className="flex-shrink-0 overflow-hidden" style={{ width: aiPanel.width }}>
          <AIPanel />
        </div>
      )}
    </div>
  )
}
