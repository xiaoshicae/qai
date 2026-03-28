import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Trash2, Pencil, Cloud, CloudOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { Environment, EnvVariable } from '@/types'

export default function EnvironmentsView() {
  const [envs, setEnvs] = useState<Environment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variables, setVariables] = useState<EnvVariable[]>([])
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const varsRef = useRef(variables)
  varsRef.current = variables

  const loadEnvs = useCallback(async () => {
    try {
      const list = await invoke<Environment[]>('list_environments')
      setEnvs(list)
      if (!selectedId && list.length > 0) {
        const active = list.find((e) => e.is_active) ?? list[0]
        setSelectedId(active.id)
      }
    } catch {}
  }, [selectedId])

  useEffect(() => {
    loadEnvs().then(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (selectedId) {
      invoke<{ environment: Environment; variables: EnvVariable[] }>('get_environment_with_vars', { id: selectedId })
        .then((r) => setVariables(r.variables))
        .catch(() => setVariables([]))
    } else {
      setVariables([])
    }
  }, [selectedId])

  // 自动保存：变量变化后 debounce 800ms 自动保存
  const autoSave = useCallback((vars: EnvVariable[]) => {
    if (!selectedId) return
    // 过滤掉空行（key 和 value 都为空的）
    const toSave = vars.filter((v) => v.key.trim() || v.value.trim())
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveIndicator('saving')
      try {
        await invoke('save_env_variables', { environmentId: selectedId, variables: toSave })
        setSaveIndicator('saved')
        setTimeout(() => setSaveIndicator('idle'), 1500)
      } catch (e) {
        console.error('自动保存失败:', e)
        setSaveIndicator('error')
        setTimeout(() => setSaveIndicator('idle'), 3000)
      }
    }, 800)
  }, [selectedId])

  const createEnv = async () => {
    try {
      const env = await invoke<Environment>('create_environment', { name: '新环境' })
      setEnvs((prev) => [...prev, env])
      setSelectedId(env.id)
      setEditingName(env.id)
      setEditName('新环境')
    } catch {}
  }

  const deleteEnv = async (id: string) => {
    try {
      await invoke('delete_environment', { id })
      setEnvs((prev) => prev.filter((e) => e.id !== id))
      if (selectedId === id) {
        setSelectedId(envs.find((e) => e.id !== id)?.id ?? null)
      }
    } catch {}
  }

  const renameEnv = async (id: string) => {
    if (!editName.trim()) { setEditingName(null); return }
    try {
      const updated = await invoke<Environment>('update_environment', { id, name: editName.trim() })
      setEnvs((prev) => prev.map((e) => e.id === id ? updated : e))
    } catch {}
    setEditingName(null)
  }

  const updateVariable = (index: number, field: keyof EnvVariable, val: string | boolean) => {
    setVariables((prev) => {
      const next = prev.map((v, i) => i === index ? { ...v, [field]: val } : v)
      // 自动追加空行：最后一行被编辑时，追加新空行
      const lastFilled = next.length > 0 && (next[next.length - 1].key.trim() || next[next.length - 1].value.trim())
      if (lastFilled) {
        next.push({ id: '', environment_id: selectedId ?? '', key: '', value: '', enabled: true, sort_order: next.length })
      }
      autoSave(next)
      return next
    })
  }

  const removeVariable = (index: number) => {
    setVariables((prev) => {
      const next = prev.filter((_, i) => i !== index)
      autoSave(next)
      return next
    })
  }

  // 确保始终有一个空行
  const displayVars = variables.length === 0 || (variables[variables.length - 1]?.key.trim() || variables[variables.length - 1]?.value.trim())
    ? [...variables, { id: '', environment_id: selectedId ?? '', key: '', value: '', enabled: true, sort_order: variables.length }]
    : variables

  if (!loaded) return null

  const selectedEnv = envs.find((e) => e.id === selectedId)

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">环境变量</h1>

      <div className="flex gap-4">
        {/* 左侧：环境列表 */}
        <div className="w-48 shrink-0 space-y-1">
          {envs.map((env) => (
            <div
              key={env.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                selectedId === env.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'
              }`}
              onClick={() => setSelectedId(env.id)}
            >
              {editingName === env.id ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => renameEnv(env.id)}
                  onKeyDown={(e) => e.key === 'Enter' && renameEnv(env.id)}
                  className="h-6 text-xs"
                  autoFocus
                />
              ) : (
                <>
                  <span className={`text-sm truncate flex-1 ${selectedId === env.id ? 'font-medium' : ''}`}>{env.name}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
                    onClick={(e) => { e.stopPropagation(); setEditingName(env.id); setEditName(env.name) }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                    onClick={(e) => { e.stopPropagation(); deleteEnv(env.id) }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
          <button
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
            onClick={createEnv}
          >
            <Plus className="h-3.5 w-3.5" />
            新建环境
          </button>
        </div>

        {/* 右侧：变量编辑 */}
        <div className="flex-1 min-w-0">
          {selectedEnv ? (
            <div className="rounded-xl bg-card border border-overlay/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{selectedEnv.name}</span>
                {/* 自动保存状态指示 */}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-opacity">
                  {saveIndicator === 'saving' && <><Cloud className="h-3 w-3 animate-pulse" /> 保存中...</>}
                  {saveIndicator === 'saved' && <><Cloud className="h-3 w-3 text-emerald-500" /> 已保存</>}
                  {saveIndicator === 'error' && <><CloudOff className="h-3 w-3 text-destructive" /> 保存失败</>}
                </div>
              </div>

              {/* 表头 */}
              <div className="flex items-center gap-2 px-1">
                <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wider">变量名</span>
                <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wider">值</span>
                <span className="w-7" />
              </div>

              {/* 变量行（含尾部空行） */}
              {displayVars.map((v, i) => {
                const isEmpty = !v.key.trim() && !v.value.trim()
                const isLast = i === displayVars.length - 1 && isEmpty
                return (
                  <div key={i} className={`flex items-center gap-2 group ${isLast ? 'opacity-50 focus-within:opacity-100 transition-opacity' : ''}`}>
                    <Input
                      value={v.key}
                      onChange={(e) => updateVariable(i, 'key', e.target.value)}
                      placeholder="KEY"
                      className="flex-1 h-7 text-xs font-mono"
                    />
                    <Input
                      value={v.value}
                      onChange={(e) => updateVariable(i, 'value', e.target.value)}
                      placeholder="value"
                      className="flex-1 h-7 text-xs font-mono"
                    />
                    {!isLast ? (
                      <button
                        className="h-7 w-7 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer transition-opacity"
                        onClick={() => removeVariable(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="w-7" />
                    )}
                  </div>
                )
              })}

              <p className="text-[11px] text-muted-foreground">
                在请求中使用 <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{'{{KEY}}'}</code> 引用变量
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <p className="text-sm text-muted-foreground">创建一个环境开始使用</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
