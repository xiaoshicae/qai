import { useState, useCallback, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { Sparkles, TerminalSquare } from 'lucide-react'
import Sidebar from './sidebar'
import AIPanel from '@/components/ai/ai-panel'
import TerminalPanel from '@/components/terminal/terminal-panel'
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
  const { open, setOpen } = useAIStore()
  const [panelMode, setPanelMode] = useState<'ai' | 'terminal'>('ai')
  const sidebar = useResizable(280, 200, 450)
  const aiPanel = useResizableRight(380, 280, 600)

  const openTerminal = () => { setPanelMode('terminal'); setOpen(true) }
  const openAI = () => { setPanelMode('ai'); setOpen(true) }

  return (
    <div className="flex h-screen bg-background">
      {/* 左侧边栏 */}
      <aside className="flex-shrink-0 overflow-hidden" style={{ width: sidebar.width }}>
        <Sidebar />
      </aside>
      {/* 左拖拽条 */}
      <div
        className="relative w-px cursor-col-resize shrink-0 group/resize divider-glow hover:w-0.5 transition-all"
        onMouseDown={sidebar.onMouseDown}
      />

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden bg-background relative min-w-[300px]">
        {/* 顶部拖拽区域（macOS 标题栏） */}
        <div className="h-8 shrink-0" data-tauri-drag-region="" />
        <div className="h-[calc(100%-2rem)] overflow-hidden">
          <Outlet />
        </div>
        {!open && (
          <div className="absolute bottom-5 right-5 flex items-center gap-2">
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/80 hover:bg-muted text-foreground/80 shadow-lg cursor-pointer transition-all duration-200 active:translate-y-px text-sm"
              onClick={openTerminal}
            >
              <TerminalSquare className="h-4 w-4" />
              终端
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl btn-gradient text-primary-foreground shadow-lg cursor-pointer transition-all duration-200 active:translate-y-px hover:shadow-xl"
              onClick={openAI}
            >
              <Sparkles className="h-4 w-4" />
              <span className="text-sm font-medium">AI 助手</span>
            </button>
          </div>
        )}
      </main>

      {/* 右拖拽条 */}
      {open && (
        <div
          className="relative w-px cursor-col-resize shrink-0 group/resize divider-glow hover:w-0.5 transition-all"
          onMouseDown={aiPanel.onMouseDown}
        />
      )}

      {/* 右面板 */}
      {open && (
        <div className="flex-shrink-0 overflow-hidden" style={{ width: aiPanel.width }}>
          {panelMode === 'terminal'
            ? <TerminalPanel onClose={() => setOpen(false)} />
            : <AIPanel />
          }
        </div>
      )}
    </div>
  )
}
