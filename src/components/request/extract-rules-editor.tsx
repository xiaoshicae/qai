import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useRequestStore } from '@/stores/request-store'
import type { ExtractRule } from '@/types'

import { EXTRACT_SOURCE_OPTIONS } from '@/lib/constants'

interface Props {
  requestId: string
}

export default function ExtractRulesEditor({ requestId }: Props) {
  const { t } = useTranslation()
  const { currentRequest } = useRequestStore()
  const [rules, setRules] = useState<ExtractRule[]>([])

  useEffect(() => {
    if (currentRequest) {
      try {
        const parsed = JSON.parse(currentRequest.extract_rules || '[]')
        setRules(parsed)
      } catch {
        setRules([])
      }
    }
  }, [currentRequest])

  const save = async (updated: ExtractRule[]) => {
    setRules(updated)
    await invoke('update_item', {
      id: requestId,
      payload: { extractRules: JSON.stringify(updated) },
    })
  }

  const addRule = () => {
    save([...rules, { var_name: '', source: 'json_body', expression: '' }])
  }

  const removeRule = (index: number) => {
    save(rules.filter((_, i) => i !== index))
  }

  const updateRule = (index: number, field: keyof ExtractRule, value: string) => {
    const updated = rules.map((r, i) =>
      i === index ? { ...r, [field]: value } : r
    )
    setRules(updated)
  }

  const handleBlur = () => {
    save(rules)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("request.extract_hint")}
        </p>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addRule}>
          <Plus className="h-3 w-3" />
          添加规则
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          暂无提取规则
        </div>
      ) : (
        <div className="space-y-0.5">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_120px_1fr_32px] gap-2 px-1 text-xs text-muted-foreground font-medium">
            <span>变量名</span>
            <span>来源</span>
            <span>表达式</span>
            <span />
          </div>
          {rules.map((rule, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_1fr_32px] gap-2 items-center">
              <Input
                value={rule.var_name}
                onChange={(e) => updateRule(i, 'var_name', e.target.value)}
                onBlur={handleBlur}
                placeholder="token"
                className="h-8 text-xs font-mono"
              />
              <Select
                value={rule.source}
                onChange={(v) => {
                  updateRule(i, 'source', v)
                  const updated = rules.map((r, idx) =>
                    idx === i ? { ...r, source: v as ExtractRule['source'] } : r
                  )
                  save(updated)
                }}
                options={EXTRACT_SOURCE_OPTIONS}
                className="w-[120px]"
              />
              <Input
                value={rule.expression}
                onChange={(e) => updateRule(i, 'expression', e.target.value)}
                onBlur={handleBlur}
                placeholder={rule.source === 'json_body' ? '$.data.token' : rule.source === 'header' ? 'Authorization' : ''}
                disabled={rule.source === 'status_code'}
                className="h-8 text-xs font-mono"
              />
              <button
                onClick={() => removeRule(i)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
