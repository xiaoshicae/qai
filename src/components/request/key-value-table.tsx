import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { KeyValuePair } from '@/types'

interface KeyValueTableProps {
  value: KeyValuePair[]
  onChange: (value: KeyValuePair[]) => void
}

export default function KeyValueTable({ value, onChange }: KeyValueTableProps) {
  const addRow = () => onChange([...value, { key: '', value: '', enabled: true }])

  const removeRow = (index: number) => onChange(value.filter((_, i) => i !== index))

  const updateRow = (index: number, field: keyof KeyValuePair, val: string | boolean) => {
    const next = [...value]
    next[index] = { ...next[index], [field]: val }
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {value.length > 0 && (
        <div className="flex items-center gap-2 px-1 mb-1">
          <span className="w-4" />
          <span className="flex-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Key</span>
          <span className="flex-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Value</span>
          <span className="w-7" />
        </div>
      )}
      {value.map((item, index) => (
        <div key={index} className="flex items-center gap-2 group">
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => updateRow(index, 'enabled', e.target.checked)}
            className="h-3.5 w-3.5 rounded border-overlay/[0.06] accent-brand cursor-pointer"
          />
          <Input
            value={item.key}
            onChange={(e) => updateRow(index, 'key', e.target.value)}
            placeholder="Key"
            className="h-7 text-xs flex-1 bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
          />
          <Input
            value={item.value}
            onChange={(e) => updateRow(index, 'value', e.target.value)}
            placeholder="Value"
            className="h-7 text-xs flex-1 bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={() => removeRow(index)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]"
        onClick={addRow}
      >
        <Plus className="h-3 w-3 mr-1" /> 添加
      </Button>
    </div>
  )
}
