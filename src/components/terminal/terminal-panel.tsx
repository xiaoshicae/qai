import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import '@xterm/xterm/css/xterm.css'
import { TerminalSquare, RefreshCw, X } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function TerminalPanel({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [spawned, setSpawned] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#0a0a0b',
        foreground: '#e4e4e7',
        cursor: '#a78bfa',
        selectionBackground: '#3f3f4640',
        black: '#18181b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a78bfa',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c4b5fd',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    // 键盘输入 → PTY
    term.onData((data) => {
      const bytes = new TextEncoder().encode(data)
      invoke('pty_write', { data: Array.from(bytes) }).catch(() => {})
    })

    // PTY 输出 → 终端
    let unlistenOutput: (() => void) | undefined
    let unlistenExit: (() => void) | undefined

    listen<string>('pty-output', (event) => {
      const bytes = Uint8Array.from(atob(event.payload), (c) => c.charCodeAt(0))
      term.write(bytes)
    }).then((fn) => { unlistenOutput = fn })

    listen('pty-exit', () => {
      term.writeln('\r\n\x1b[33m[终端已退出]\x1b[0m')
      setSpawned(false)
    }).then((fn) => { unlistenExit = fn })

    // 启动 PTY
    const { cols, rows } = term
    invoke('pty_spawn', { cols, rows }).then(() => {
      setSpawned(true)
    }).catch((e) => {
      term.writeln(`\x1b[31m启动终端失败: ${e}\x1b[0m`)
    })

    // 监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (termRef.current) {
        const { cols, rows } = termRef.current
        invoke('pty_resize', { cols, rows }).catch(() => {})
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      unlistenOutput?.()
      unlistenExit?.()
      invoke('pty_kill').catch(() => {})
      term.dispose()
    }
  }, [])

  const handleRestart = async () => {
    await invoke('pty_kill').catch(() => {})
    if (termRef.current) {
      termRef.current.clear()
      const { cols, rows } = termRef.current
      await invoke('pty_spawn', { cols, rows })
      setSpawned(true)
    }
  }

  // 自动启动 claude（带 MCP 配置）
  const handleStartClaude = async () => {
    try {
      const configPath = await invoke<string>('prepare_mcp_config')
      const cmd = `claude --mcp-config "${configPath}"\n`
      const bytes = new TextEncoder().encode(cmd)
      await invoke('pty_write', { data: Array.from(bytes) })
    } catch (e) {
      termRef.current?.writeln(`\x1b[31mClaude 启动失败: ${e}\x1b[0m`)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0b]">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]" data-tauri-drag-region="">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground/80">终端</span>
        </div>
        <div className="flex items-center gap-1">
          {spawned && (
            <button
              onClick={handleStartClaude}
              className="px-2 py-0.5 rounded text-[10px] font-medium text-primary hover:bg-primary/10 cursor-pointer transition-colors"
            >
              启动 Claude
            </button>
          )}
          <button onClick={handleRestart} className="p-1 rounded hover:bg-white/[0.06] cursor-pointer transition-colors" title="重启终端">
            <RefreshCw className="h-3 w-3 text-muted-foreground" />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] cursor-pointer transition-colors" title="关闭">
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* 终端容器 */}
      <div ref={containerRef} className="flex-1 px-1 py-1" />
    </div>
  )
}
