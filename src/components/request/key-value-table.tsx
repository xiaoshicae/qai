import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const addRow = () => onChange([...value, { key: '', value: '', enabled: true }])
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
          <div key={index} className={`grid ${gridCols} gap-2 items-center group/row ${!item.enabled ? 'opacity-40' : ''} transition-opacity`}>
            <button
              onClick={() => updateRow(index, 'enabled', !item.enabled)}
              className={`h-3 w-3 rounded-sm border transition-colors cursor-pointer ${item.enabled ? 'bg-primary border-primary' : 'border-overlay/[0.15] hover:border-overlay/[0.25]'}`}
            >
              {item.enabled && <svg viewBox="0 0 12 12" className="h-3 w-3 text-primary-foreground"><path d="M3.5 6L5.5 8L8.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>}
            </button>
            {allowFiles && (
              <button
                onClick={() => toggleFieldType(index)}
                className={`h-7 w-7 flex items-center justify-center rounded-lg text-xs transition-colors cursor-pointer ${
                  isFile ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'
                }`}
                title={isFile ? t('request.file_field') : t('request.text_field')}
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
                title={item.value || t('request.click_select_file')}
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
              className="h-7 w-7 opacity-0 group-hover/row:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )
      })}
      <button onClick={addRow} className="w-full h-7 flex items-center justify-center gap-1 rounded-lg text-xs text-muted-foreground/60 hover:text-muted-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1] transition-colors cursor-pointer">
        <Plus className="h-3 w-3" />
      </button>
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
            <span key={i} className={`rounded-sm px-0.5 ${resolved ? 'bg-variable/15 text-variable' : 'bg-error/15 text-error'}`}>
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
