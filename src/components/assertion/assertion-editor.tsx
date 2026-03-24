import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Assertion } from '@/types'

const TYPE_OPTIONS = [
  { label: '状态码', value: 'status_code' },
  { label: 'JSON Path', value: 'json_path' },
  { label: '响应体包含', value: 'body_contains' },
  { label: '响应时间', value: 'response_time' },
  { label: 'Header', value: 'header_contains' },
]

const OPERATOR_OPTIONS = [
  { label: '等于', value: 'eq' },
  { label: '不等于', value: 'neq' },
  { label: '大于', value: 'gt' },
  { label: '小于', value: 'lt' },
  { label: '包含', value: 'contains' },
  { label: '不包含', value: 'not_contains' },
  { label: '存在', value: 'exists' },
  { label: '正则', value: 'matches' },
]

function needsExpression(type: string) {
  return type === 'json_path' || type === 'header_contains'
}

export default function AssertionEditor({ requestId }: { requestId: string }) {
  const [assertions, setAssertions] = useState<Assertion[]>([])

  const load = useCallback(async () => {
    const list = await invoke<Assertion[]>('list_assertions', { requestId })
    setAssertions(list)
  }, [requestId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    await invoke('create_assertion', {
      requestId,
      assertionType: 'status_code',
      expression: '',
      operator: 'eq',
      expected: '200',
    })
    await load()
  }

  const update = async (id: string, field: string, value: any) => {
    const params: any = { id }
    if (field === 'type') params.assertionType = value
    else if (field === 'enabled') params.enabled = value
    else params[field] = value
    await invoke('update_assertion', params)
  }

  const remove = async (id: string) => {
    await invoke('delete_assertion', { id })
    await load()
  }

  return (
    <div className="space-y-1.5">
      {assertions.length > 0 && (
        <div className="flex items-center gap-1.5 px-0.5 mb-1">
          <span className="w-3.5" />
          <span className="w-[100px] text-[10px] text-muted-foreground/60 uppercase tracking-wider">类型</span>
          <span className="flex-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider">条件</span>
        </div>
      )}
      {assertions.map((a) => (
        <div key={a.id} className="flex items-center gap-1.5 group">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => update(a.id, 'enabled', e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-brand cursor-pointer"
          />
          <select
            value={a.type}
            onChange={(e) => {
              const newType = e.target.value
              update(a.id, 'type', newType)
              setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, type: newType } : item))
            }}
            className="h-7 rounded-md border border-input bg-surface-1 px-1.5 text-xs cursor-pointer w-[100px] focus:outline-none focus:ring-1 focus:ring-brand/50"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {needsExpression(a.type) && (
            <Input
              defaultValue={a.expression}
              onBlur={(e) => update(a.id, 'expression', e.target.value)}
              placeholder={a.type === 'json_path' ? '$.data.id' : 'content-type'}
              className="h-7 text-xs w-[120px] bg-surface-1 border-transparent focus-visible:border-border"
            />
          )}
          <select
            value={a.operator}
            onChange={(e) => update(a.id, 'operator', e.target.value)}
            className="h-7 rounded-md border border-input bg-surface-1 px-1.5 text-xs cursor-pointer w-[80px] focus:outline-none focus:ring-1 focus:ring-brand/50"
          >
            {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Input
            defaultValue={a.expected}
            onBlur={(e) => update(a.id, 'expected', e.target.value)}
            placeholder="预期值"
            className="h-7 text-xs flex-1 min-w-[60px] bg-surface-1 border-transparent focus-visible:border-border"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={() => remove(a.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border/50 hover:border-border"
        onClick={add}
      >
        <Plus className="h-3 w-3 mr-1" /> 添加断言
      </Button>
    </div>
  )
}
