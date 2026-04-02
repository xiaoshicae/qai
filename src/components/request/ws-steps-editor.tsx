import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Braces } from 'lucide-react'
import { CodeEditor } from '@/components/ui/code-editor'

interface WsStep {
  id: string
  body: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  onSubmit: () => void
}

function parseSteps(bodyContent: string): WsStep[] {
  const trimmed = bodyContent.trim()
  if (!trimmed) return [{ id: crypto.randomUUID(), body: '' }]

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
      return parsed.map((item: unknown) => ({
        id: crypto.randomUUID(),
        body: JSON.stringify(item, null, 2),
      }))
    }
  } catch { /* not an array */ }

  // 单个对象或无效 JSON → 单步
  return [{ id: crypto.randomUUID(), body: trimmed }]
}

function serializeSteps(steps: WsStep[]): string {
  if (steps.length === 0) return ''
  if (steps.length === 1) return steps[0].body
  const items = steps.map(s => {
    try { return JSON.parse(s.body) }
    catch { return {} }
  })
  return JSON.stringify(items, null, 2)
}

export function WsStepsEditor({ value, onChange, onBlur, onSubmit }: Props) {
  const { t } = useTranslation()
  const [steps, setSteps] = useState<WsStep[]>(() => parseSteps(value))
  const internalRef = useRef(false)

  // 外部值变更时（切换请求）重新解析
  useEffect(() => {
    if (internalRef.current) {
      internalRef.current = false
      return
    }
    setSteps(parseSteps(value))
  }, [value])

  const emit = useCallback((next: WsStep[]) => {
    setSteps(next)
    internalRef.current = true
    onChange(serializeSteps(next))
  }, [onChange])

  const updateBody = useCallback((id: string, body: string) => {
    setSteps(prev => {
      const next = prev.map(s => s.id === id ? { ...s, body } : s)
      internalRef.current = true
      onChange(serializeSteps(next))
      return next
    })
  }, [onChange])

  const addStep = useCallback(() => {
    emit([...steps, { id: crypto.randomUUID(), body: '{\n  \n}' }])
  }, [steps, emit])

  const removeStep = useCallback((id: string) => {
    if (steps.length <= 1) return
    emit(steps.filter(s => s.id !== id))
  }, [steps, emit])

  const formatStep = useCallback((id: string) => {
    setSteps(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s
        try { return { ...s, body: JSON.stringify(JSON.parse(s.body), null, 2) } }
        catch { return s }
      })
      internalRef.current = true
      onChange(serializeSteps(next))
      return next
    })
  }, [onChange])

  const isMulti = steps.length > 1

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={step.id} className="rounded-xl border border-overlay/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-overlay/[0.02]">
            <span className="text-xs font-medium text-muted-foreground">
              {isMulti ? t('ws.step_n', { n: index + 1 }) : 'JSON'}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => formatStep(step.id)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04] cursor-pointer transition-colors"
            >
              <Braces className="h-2.5 w-2.5" /> Format
            </button>
            {isMulti && (
              <button
                onClick={() => removeStep(step.id)}
                className="p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
          <CodeEditor
            value={step.body}
            onChange={(val) => updateBody(step.id, val)}
            onBlur={onBlur}
            language="json"
            placeholder='{ "key": "value" }'
            className={isMulti ? 'h-[140px]' : 'h-[280px]'}
            onSubmitChord={onSubmit}
          />
        </div>
      ))}
      <button
        onClick={addStep}
        className="flex items-center gap-1.5 px-3 py-2 w-full rounded-xl border border-dashed border-overlay/[0.08] text-xs text-muted-foreground hover:text-foreground hover:border-overlay/[0.12] hover:bg-overlay/[0.02] cursor-pointer transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('ws.add_message')}
      </button>
      {isMulti && (
        <p className="text-[10px] text-muted-foreground/60">
          {t('ws.multi_step_hint')}
        </p>
      )}
    </div>
  )
}
