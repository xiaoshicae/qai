import { useState, useCallback, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Sidebar from './sidebar'
import AIPanel from '@/components/ai/ai-panel'
import TerminalPanel from '@/components/terminal/terminal-panel'
import EnvSelector from '@/components/layout/env-selector'
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
        {/* 顶部拖拽区域（macOS 标题栏）+ 环境选择器 */}
        <div className="h-8 shrink-0 flex items-center justify-end pr-3" data-tauri-drag-region="">
          <EnvSelector />
        </div>
        <div className="h-[calc(100%-2rem)] overflow-hidden">
          <Outlet />
        </div>
        {!open && (
          <div className="absolute bottom-5 right-5 flex items-center gap-2">
            <button
              className="flex items-center justify-center h-10 w-10 rounded-full glass-card shadow-lg cursor-pointer transition-all duration-200 active:translate-y-px hover:shadow-xl hover:scale-105"
              onClick={openTerminal}
              title="Claude Code"
            >
              <svg width="18" height="18" viewBox="0 0 52 49" fill="none" className="shrink-0">
                <path d="M23.15 45.53l.66-2.91.75-3.76.61-3.01.57-3.71.33-1.22-.05-.1-.23.05-2.82 3.85-4.28 5.78-3.38 3.57-.8.33-1.41-.7.14-1.32.8-1.13 4.65-5.97 2.82-3.71 1.83-2.12-.05-.28h-.09L10.79 37.25l-2.21.28-1-.89.15-1.46.47-.47 3.71-2.58 9.26-5.17.14-.47-.14-.24h-.47l-1.55-.09-5.26-.14-4.56-.19-4.47-.24-1.13-.23-1.03-1.41.09-.71.94-.61 1.36.09 2.96.24 4.47.28 3.24.19 4.8.52h.75l.09-.33-.24-.19-.19-.19-4.65-3.1-4.98-3.29-2.63-1.93-1.41-.99-.7-.89-.29-1.97 1.27-1.41 1.74.14.42.09 1.74 1.36 3.71 2.87 4.89 3.62.7.56.33-.19v-.14l-.33-.52-2.63-4.79-2.82-4.89-1.27-2.02-.33-1.22c-.13-.42-.19-.89-.19-1.41l1.46-1.97.8-.28 1.97.28.8.7 1.22 2.77 1.93 4.37 3.05 5.92.9 1.79.47 1.6.19.52h.33v-.28l.24-3.38.47-4.09.47-5.26.14-1.5.75-1.79 1.46-.94 1.13.52.94 1.36-.14.85-.52 3.62-1.13 5.69-.7 3.85h.42l.47-.52 1.93-2.54 3.24-4.04 1.41-1.6 1.69-1.79 1.08-.85h2.02l1.46 2.21-.66 2.3-2.07 2.63-1.74 2.21-2.49 3.34-1.5 2.68.14.19h.33l5.59-1.22 3.05-.52 3.57-.61 1.65.75.19.75-.66 1.6-3.85.94-4.51.89-6.72 1.6-.09.05.09.14 3.01.28 1.32.09h3.19l5.92.42 1.55 1.03.9 1.22-.14.99-2.4 1.18-3.19-.75-7.52-1.79-2.54-.61h-.38v.19l2.16 2.12 3.9 3.52 4.94 4.56.24 1.13-.61.94-.66-.09-4.32-3.29-1.69-1.46-3.76-3.15h-.24v.33l.85 1.27 4.61 6.91.24 2.12-.33.66-1.22.42-1.27-.24-2.73-3.76-2.77-4.28-2.26-3.81-.24.19-1.36 14.19-.61.71-1.41.56-1.18-.89-.66-1.46z" fill="#D97757" />
              </svg>
            </button>
            <button
              className="flex items-center justify-center h-10 w-10 rounded-full glass-card shadow-lg cursor-pointer transition-all duration-200 active:translate-y-px hover:shadow-xl hover:scale-105 text-primary"
              onClick={openAI}
              title="AI 助手"
            >
              <Sparkles className="h-4.5 w-4.5" />
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
