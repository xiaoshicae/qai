import { Plus, Trash2, FileUp, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { open } from '@tauri-apps/plugin-dialog'
import type { KeyValuePair } from '@/types'

interface KeyValueTableProps {
  value: KeyValuePair[]
  onChange: (value: KeyValuePair[]) => void
  /** 启用文件上传切换（form-data 模式） */
  allowFiles?: boolean
}

export default function KeyValueTable({ value, onChange, allowFiles }: KeyValueTableProps) {
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
    if (selected) {
      updateRow(index, 'value', selected as string)
    }
  }

  const fileName = (path: string) => {
    if (!path) return ''
    return path.split('/').pop() || path.split('\\').pop() || path
  }

  return (
    <div className="space-y-1">
      {value.length > 0 && (
        <div className="flex items-center gap-2 px-1 mb-1">
          <span className="w-4" />
          {allowFiles && <span className="w-7" />}
          <span className="flex-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Key</span>
          <span className="flex-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Value</span>
          <span className="w-7" />
        </div>
      )}
      {value.map((item, index) => {
        const isFile = item.fieldType === 'file'
        return (
          <div key={index} className="flex items-center gap-2 group">
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
              className="h-7 text-xs flex-1 bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
            />
            {isFile ? (
              <button
                onClick={() => pickFile(index)}
                className="flex-1 h-7 rounded-lg border border-dashed border-overlay/[0.08] bg-overlay/[0.03] px-3 text-xs text-left truncate cursor-pointer hover:border-overlay/[0.12] transition-colors"
                title={item.value || '点击选择文件'}
              >
                {item.value ? (
                  <span className="text-foreground">{fileName(item.value)}</span>
                ) : (
                  <span className="text-muted-foreground">点击选择文件...</span>
                )}
              </button>
            ) : (
              <Input
                value={item.value}
                onChange={(e) => updateRow(index, 'value', e.target.value)}
                placeholder="Value"
                className="h-7 text-xs flex-1 bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
              />
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
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]"
          onClick={addRow}
        >
          <Plus className="h-3 w-3 mr-1" /> 添加
        </Button>
        {allowFiles && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]"
            onClick={addFileRow}
          >
            <FileUp className="h-3 w-3 mr-1" /> 添加文件
          </Button>
        )}
      </div>
    </div>
  )
}
