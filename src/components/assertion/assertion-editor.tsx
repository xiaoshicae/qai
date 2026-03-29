import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { Assertion } from '@/types'

function useTypeOptions() {
  const { t } = useTranslation()
  return [
    { label: t('assertion.status_code'), value: 'status_code' },
    { label: 'JSON Path', value: 'json_path' },
    { label: t('assertion.body_contains'), value: 'body_contains' },
    { label: t('assertion.response_time'), value: 'response_time' },
    { label: 'Header', value: 'header_contains' },
  ]
}

function useOperatorOptions() {
  const { t } = useTranslation()
  return [
    { label: t('assertion.eq'), value: 'eq' },
    { label: t('assertion.neq'), value: 'neq' },
    { label: t('assertion.gt'), value: 'gt' },
    { label: t('assertion.lt'), value: 'lt' },
    { label: t('assertion.contains'), value: 'contains' },
    { label: t('assertion.not_contains'), value: 'not_contains' },
    { label: t('assertion.exists'), value: 'exists' },
    { label: t('assertion.matches'), value: 'matches' },
  ]
}

function needsExpression(type: string) {
  return type === 'json_path' || type === 'header_contains'
}

export default function AssertionEditor({ requestId }: { requestId: string }) {
  const TYPE_OPTIONS = useTypeOptions()
  const OPERATOR_OPTIONS = useOperatorOptions()
  const [assertions, setAssertions] = useState<Assertion[]>([])

  const load = useCallback(async () => {
    const list = await invoke<Assertion[]>('list_assertions', { itemId: requestId })
    setAssertions(list)
  }, [requestId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    await invoke('create_assertion', {
      itemId: requestId,
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
          <Select
            value={a.type}
            onChange={(v) => {
              update(a.id, 'type', v)
              setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, type: v } : item))
            }}
            options={TYPE_OPTIONS}
            className="w-[100px]"
          />
          {needsExpression(a.type) && (
            <Input
              defaultValue={a.expression}
              onBlur={(e) => update(a.id, 'expression', e.target.value)}
              placeholder={a.type === 'json_path' ? '$.data.id' : 'content-type'}
              className="h-7 text-xs w-[120px] bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
            />
          )}
          <Select
            value={a.operator}
            onChange={(v) => update(a.id, 'operator', v)}
            options={OPERATOR_OPTIONS}
            className="w-[80px]"
          />
          <Input
            defaultValue={a.expected}
            onBlur={(e) => update(a.id, 'expected', e.target.value)}
            placeholder="预期值"
            className="h-7 text-xs flex-1 min-w-[60px] bg-overlay/[0.03] border-transparent focus-visible:border-overlay/[0.12]"
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
        className="w-full h-7 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.1]"
        onClick={add}
      >
        <Plus className="h-3 w-3 mr-1" /> 添加断言
      </Button>
    </div>
  )
}
