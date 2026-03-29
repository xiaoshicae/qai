import { useRef, useState } from 'react'
import { Plus, Trash2, FileUp, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VarHighlight } from '@/components/ui/var-highlight'
import { open } from '@tauri-apps/plugin-dialog'
import type { KeyValuePair } from '@/types'

interface KeyValueTableProps {
  value: KeyValuePair[]
  onChange: (value: KeyValuePair[]) => void
  allowFiles?: boolean
  envVars?: Record<string, string>
}

export default function KeyValueTable({ value, onChange, allowFiles, envVars }: KeyValueTableProps) {
  const addRow = () => onChange([...value, { key: '', value: '', enabled: true }])
  const addFileRow = () => onChange([...value, { key: '', value: '', enabled: true, fieldType: 'file' }])
  const removeRow = (index: number) => onChange(value.filter((_, i) => i !== index))
  const updateRow = (index: number, field: keyof KeyValuePair, val: string | boolean) => {
    const next = [...value]
    next[index] = { ...next[index], [field]: val }
    onChange(next)
  }
  const toggleFieldType = (index: number) => {
    const next = [...value]
    const current = next[index].fieldType || 'text'
    next[index] = { ...next[index], fieldType: current === 'file' ? 'text' : 'file', value: '' }
    onChange(next)
  }
  const pickFile = async (index: number) => {
    const selected = await open({ multiple: false })
    if (selected) updateRow(index, 'value', selected as string)
  }
  const fileName = (path: string) => {
    if (!path) return ''
    return path.split('/').pop() || path.split('\\').pop() || path
  }

  // grid 列模板：checkbox | (files toggle) | key 30% | value 剩余 | delete
  const gridCols = allowFiles
    ? 'grid-cols-[14px_28px_30%_1fr_28px]'
    : 'grid-cols-[14px_30%_1fr_28px]'

  return (
    <div className="space-y-1">
      {value.length > 0 && (
        <div className={`grid ${gridCols} gap-2 px-1 mb-1 items-center`}>
          <span />
          {allowFiles && <span />}
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Key</span>
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Value</span>
          <span />
        </div>
      )}
      {value.map((item, index) => {
        const isFile = item.fieldType === 'file'
        return (
          <div key={index} className={`grid ${gridCols} gap-2 items-center group`}>
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => updateRow(index, 'enabled', e.target.checked)}
              className="h-3.5 w-3.5 rounded border-overlay/[0.06] accent-brand cursor-pointer"
            />
            {allowFiles && (
              <button
                onClick={() => toggleFieldType(index)}
                className={`h-7 w-7 flex items-center justify-center rounded-lg text-xs transition-colors cursor-pointer ${
                  isFile ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'
                }`}
                title={isFile ? '文件字段（点击切换为文本）' : '文本字段（点击切换为文件）'}
              >
                {isFile ? <FileUp className="h-3 w-3" /> : <Type className="h-3 w-3" />}
              </button>
            )}
            <Input
              value={item.key}
              onChange={(e) => updateRow(index, 'key', e.target.value)}
              placeholder="Key"
              className="h-7 text-xs bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
            />
            {isFile ? (
              <button
                onClick={() => pickFile(index)}
                className="h-7 rounded-lg border border-dashed border-overlay/[0.08] bg-overlay/[0.03] px-3 text-xs text-left truncate cursor-pointer hover:border-overlay/[0.12] transition-colors"
                title={item.value || '点击选择文件'}
              >
                {item.value ? (
                  <span className="text-foreground">{fileName(item.value)}</span>
                ) : (
                  <span className="text-muted-foreground">点击选择文件...</span>
                )}
              </button>
            ) : (
              <VarValueInput value={item.value} onChange={(v) => updateRow(index, 'value', v)} envVars={envVars} />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )
      })}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1 h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> 添加
        </Button>
        {allowFiles && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]" onClick={addFileRow}>
            <FileUp className="h-3 w-3 mr-1" /> 添加文件
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Value 输入框：有 {{变量}} 时显示高亮
 * 未聚焦：显示 VarHighlight（带 hover tooltip）
 * 聚焦：显示透明文字 input + 高亮 overlay（可编辑）
 */
function VarValueInput({ value, onChange, envVars }: { value: string; onChange: (v: string) => void; envVars?: Record<string, string> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasVars = envVars && value.includes('{{')
  const [focused, setFocused] = useState(false)

  if (!hasVars) {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Value" className="h-7 text-xs bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]" />
  }

  // 未聚焦：显示 VarHighlight（正确的 tooltip 定位）
  if (!focused) {
    return (
      <div className="relative min-w-0">
        <div
          className="h-7 rounded-lg bg-overlay/[0.03] border border-transparent px-2 text-xs font-mono leading-7 overflow-hidden whitespace-nowrap cursor-text transition-colors hover:border-overlay/[0.12]"
          onClick={() => { setFocused(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
        >
          <VarHighlight text={value} vars={envVars} className="text-xs font-mono" />
        </div>
        <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" tabIndex={-1} />
      </div>
    )
  }

  // 聚焦：可编辑模式
  const segments = value.split(/(\{\{\w+\}\})/).filter(Boolean)

  return (
    <div className="relative min-w-0">
      <div className="absolute inset-0 px-2 pointer-events-none overflow-hidden whitespace-nowrap text-xs font-mono leading-7" aria-hidden>
        {segments.map((seg, i) => {
          const match = seg.match(/^\{\{(\w+)\}\}$/)
          if (!match) return <span key={i} className="text-foreground">{seg}</span>
          const varName = match[1]
          const resolved = varName in envVars!
          return (
            <span key={i} className={`rounded-sm px-0.5 ${resolved ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' : 'bg-red-500/15 text-red-500'}`}>
              {seg}
            </span>
          )
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setFocused(false)}
        placeholder="Value"
        autoFocus
        className="w-full h-7 text-xs font-mono px-2 rounded-lg bg-overlay/[0.03] border border-transparent outline-none focus-visible:border-overlay/[0.12] text-transparent caret-foreground"
      />
    </div>
  )
}
