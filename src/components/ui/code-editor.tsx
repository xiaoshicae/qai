import { useRef, useEffect } from 'react'
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react'
import type * as monacoType from 'monaco-editor'
import { useThemeStore } from '@/stores/theme-store'
import '@/lib/monaco-setup'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: 'json' | 'xml' | 'html' | 'javascript' | 'python' | 'shell' | 'plaintext'
  placeholder?: string
  readOnly?: boolean
  className?: string
  onBlur?: () => void
  onMount?: (editor: monacoType.editor.IStandaloneCodeEditor) => void
}

export function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  placeholder,
  readOnly,
  className,
  onBlur,
  onMount: onMountProp,
}: CodeEditorProps) {
  const { resolved } = useThemeStore()
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.onDidBlurEditorWidget(() => onBlur?.())
    onMountProp?.(editor)
  }

  const handleChange: OnChange = (val) => {
    onChange(val ?? '')
  }

  // 容器尺寸变化时通知 Monaco 重新布局
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => editorRef.current?.layout())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className={`relative overflow-hidden rounded-xl border border-overlay/[0.08] ${className ?? ''}`}>
      {/* placeholder 层 */}
      {!value && placeholder && (
        <div className="absolute inset-0 px-4 py-2 text-xs text-muted-foreground/40 font-mono pointer-events-none z-10 whitespace-pre-wrap">
          {placeholder}
        </div>
      )}
      <Editor
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        language={language}
        theme={resolved === 'dark' ? 'qai-dark' : 'qai-light'}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineHeight: 20,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          automaticLayout: true,
          tabSize: 2,
          readOnly,
          wordWrap: 'on',
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          lineNumbers: 'off',
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          scrollbar: {
            verticalScrollbarSize: 4,
            horizontalScrollbarSize: 4,
            verticalSliderSize: 4,
          },
          padding: { top: 8, bottom: 8 },
          contextmenu: true,
          formatOnPaste: true,
        }}
      />
    </div>
  )
}

export default CodeEditor
