import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Trash2, Check, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Environment, EnvVariable } from '@/types'

export default function EnvironmentsView() {
  const [envs, setEnvs] = useState<Environment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variables, setVariables] = useState<EnvVariable[]>([])
  const [newEnvName, setNewEnvName] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loaded, setLoaded] = useState(false)

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

  const createEnv = async () => {
    const name = newEnvName.trim() || '新环境'
    try {
      const env = await invoke<Environment>('create_environment', { name })
      setEnvs((prev) => [...prev, env])
      setSelectedId(env.id)
      setNewEnvName('')
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

  const toggleActive = async (id: string) => {
    try {
      await invoke('set_active_environment', { id })
      setEnvs((prev) => prev.map((e) => ({ ...e, is_active: e.id === id })))
    } catch {}
  }

  const addVariable = () => {
    setVariables((prev) => [...prev, {
      id: '', environment_id: selectedId ?? '', key: '', value: '', enabled: true, sort_order: prev.length,
    }])
  }

  const updateVariable = (index: number, field: keyof EnvVariable, val: string | boolean) => {
    setVariables((prev) => prev.map((v, i) => i === index ? { ...v, [field]: val } : v))
  }

  const removeVariable = (index: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== index))
  }

  const saveVariables = async () => {
    if (!selectedId) return
    try {
      await invoke('save_env_variables', { environmentId: selectedId, variables })
    } catch {}
  }

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
                  {env.is_active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
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
            <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{selectedEnv.name}</span>
                  {selectedEnv.is_active ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">使用中</span>
                  ) : (
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                      onClick={() => toggleActive(selectedEnv.id)}
                    >
                      设为活跃
                    </button>
                  )}
                </div>
              </div>

              {/* 表头 */}
              {variables.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <span className="w-4" />
                  <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wider">变量名</span>
                  <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wider">值</span>
                  <span className="w-7" />
                </div>
              )}

              {/* 变量行 */}
              {variables.map((v, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    onChange={(e) => updateVariable(i, 'enabled', e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                  />
                  <Input
                    value={v.key}
                    onChange={(e) => updateVariable(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="flex-1 h-7 text-xs font-mono dark:bg-input/30"
                  />
                  <Input
                    value={v.value}
                    onChange={(e) => updateVariable(i, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 h-7 text-xs font-mono dark:bg-input/30"
                  />
                  <button
                    className="h-7 w-7 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer transition-opacity"
                    onClick={() => removeVariable(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1" onClick={addVariable}>
                  <Plus className="h-3 w-3" /> 添加变量
                </Button>
                <div className="flex-1" />
                <Button size="sm" className="gap-1" onClick={saveVariables}>
                  <Check className="h-3 w-3" /> 保存
                </Button>
              </div>

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
