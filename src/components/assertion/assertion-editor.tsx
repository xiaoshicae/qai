import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ShieldCheck } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { invokeErrorMessage } from '@/lib/invoke-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { Assertion } from '@/types'

function useTypeOptions() {
  const { t } = useTranslation()
  return [
    { label: t('assertion.status_code'), value: 'status_code' },
    { label: t('assertion.json_path'), value: 'json_path' },
    { label: t('assertion.body_contains'), value: 'body_contains' },
    { label: t('assertion.response_time'), value: 'response_time' },
    { label: t('assertion.header_contains'), value: 'header_contains' },
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

/** 断言类型的简短标签 */
function typeLabel(type: string): string {
  switch (type) {
    case 'status_code': return 'Status'
    case 'json_path': return 'JSON'
    case 'body_contains': return 'Body'
    case 'response_time': return 'Time'
    case 'header_contains': return 'Header'
    default: return type
  }
}

/** 断言描述：一行可读的断言规则 */
function assertionSummary(a: Assertion): string {
  const expr = needsExpression(a.type) ? a.expression : ''
  const op = a.operator
  const expected = a.expected
  if (a.type === 'status_code') return `${op} ${expected}`
  if (op === 'exists') return expr ? `${expr} exists` : 'exists'
  return expr ? `${expr} ${op} ${expected}` : `${op} ${expected}`
}

export default function AssertionEditor({ requestId }: { requestId: string }) {
  const { t } = useTranslation()
  const TYPE_OPTIONS = useTypeOptions()
  const OPERATOR_OPTIONS = useOperatorOptions()
  const [assertions, setAssertions] = useState<Assertion[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await invoke<Assertion[]>('list_assertions', { itemId: requestId })
    setAssertions(list)
  }, [requestId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const a = await invoke<Assertion>('create_assertion', {
      itemId: requestId,
      assertionType: 'status_code',
      expression: '',
      operator: 'eq',
      expected: '200',
    })
    await load()
    setEditingId(a.id)
  }

  const update = async (id: string, field: string, value: unknown) => {
    const params: Record<string, unknown> = { id }
    if (field === 'type') params.assertionType = value
    else if (field === 'enabled') params.enabled = value
    else params[field] = value
    try {
      await invoke('update_assertion', params)
    } catch (e: unknown) {
      toast.error(invokeErrorMessage(e))
      load()
    }
  }

  const remove = async (id: string) => {
    await invoke('delete_assertion', { id })
    if (editingId === id) setEditingId(null)
    await load()
  }

  return (
    <div className="space-y-1">
      {assertions.map((a) => (
        <div key={a.id}>
          {/* 折叠态：紧凑的单行 */}
          <div
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors group ${editingId === a.id ? 'bg-overlay/[0.06]' : 'hover:bg-overlay/[0.04]'}`}
            onClick={() => setEditingId(editingId === a.id ? null : a.id)}
          >
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) => { e.stopPropagation(); update(a.id, 'enabled', e.target.checked); setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, enabled: e.target.checked } : item)) }}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0"
            />
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${a.type === 'status_code' ? 'text-success/70 bg-success/10' : a.type === 'json_path' ? 'text-info/70 bg-info/10' : a.type === 'header_contains' ? 'text-warning/70 bg-warning/10' : 'text-muted-foreground/70 bg-overlay/[0.06]'}`}>
              {typeLabel(a.type)}
            </span>
            <span className={`text-xs font-mono truncate ${a.enabled ? 'text-foreground/80' : 'text-muted-foreground/40 line-through'}`}>
              {assertionSummary(a)}
            </span>
            <button
              type="button"
              className="ml-auto h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-destructive/10 transition-all cursor-pointer shrink-0"
              onClick={(e) => { e.stopPropagation(); remove(a.id) }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </button>
          </div>

          {/* 展开态：编辑字段 */}
          {editingId === a.id && (
            <div className="px-2.5 pb-2.5 pt-1 ml-6 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground/60 w-12 shrink-0">{t('assertion.type_label')}</label>
                <Select
                  value={a.type}
                  onChange={(v) => {
                    update(a.id, 'type', v)
                    setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, type: v } : item))
                  }}
                  options={TYPE_OPTIONS}
                  className="flex-1"
                />
              </div>
              {needsExpression(a.type) && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-muted-foreground/60 w-12 shrink-0">{t('assertion.expr_label')}</label>
                  <Input
                    defaultValue={a.expression}
                    onBlur={(e) => { update(a.id, 'expression', e.target.value); setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, expression: e.target.value } : item)) }}
                    placeholder={a.type === 'json_path' ? '$.data.id' : 'Content-Type'}
                    className="h-7 text-xs flex-1"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground/60 w-12 shrink-0">{t('assertion.op_label')}</label>
                <Select
                  value={a.operator}
                  onChange={(v) => { update(a.id, 'operator', v); setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, operator: v } : item)) }}
                  options={OPERATOR_OPTIONS}
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground/60 w-12 shrink-0">{t('assertion.expected_label')}</label>
                <Input
                  defaultValue={a.expected}
                  onBlur={(e) => { update(a.id, 'expected', e.target.value); setAssertions((prev) => prev.map((item) => item.id === a.id ? { ...item, expected: e.target.value } : item)) }}
                  placeholder={t('assertion.expected_placeholder')}
                  className="h-7 text-xs flex-1"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      {assertions.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground/40">
          <ShieldCheck className="h-8 w-8" />
          <span className="text-xs">{t('assertion.empty_hint')}</span>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full h-8 text-xs text-muted-foreground hover:text-foreground border border-dashed border-overlay/[0.06] hover:border-overlay/[0.12] rounded-lg"
        onClick={add}
      >
        <Plus className="h-3 w-3 mr-1.5" /> {t('assertion.add')}
      </Button>
    </div>
  )
}
