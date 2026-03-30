import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

/**
 * 加载当前激活环境的变量，监听 env-changed 事件自动刷新。
 * 用于 request-panel / collection-overview 等需要环境变量的场景。
 */
export function useEnvVars() {
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [activeEnvName, setActiveEnvName] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const envs = await invoke<{ id: string; name: string; is_active: boolean }[]>('list_environments')
      const active = envs.find((e) => e.is_active)
      if (active) {
        setActiveEnvName(active.name)
        const data = await invoke<{ variables: { key: string; value: string; enabled: boolean }[] }>(
          'get_environment_with_vars',
          { id: active.id },
        )
        const map: Record<string, string> = {}
        for (const v of data.variables) if (v.enabled) map[v.key] = v.value
        setEnvVars(map)
      } else {
        setActiveEnvName(null)
        setEnvVars({})
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.addEventListener('env-changed', load)
    return () => window.removeEventListener('env-changed', load)
  }, [load])

  return { envVars, activeEnvName }
}
