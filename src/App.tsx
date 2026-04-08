import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import AppLayout from './components/layout/app-layout'
import WorkbenchView from './views/workbench-view'
import { ConfirmDialog } from './components/ui/confirm-dialog'
import { ShortcutHelpProvider } from './components/ui/shortcut-help'
import { ErrorBoundary } from './components/ui/error-boundary'
import { useThemeStore } from './stores/theme-store'
import { useCollectionStore } from './stores/collection-store'
import { initConsoleListener } from './stores/console-store'
import { invokeErrorMessage } from './lib/invoke-error'

const EnvironmentsView = lazy(() => import('./views/environments-view'))
const HistoryView = lazy(() => import('./views/history-view'))
const SettingsView = lazy(() => import('./views/settings-view'))

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

/** 监听 macOS 菜单事件 */
function MenuListener() {
  const navigate = useNavigate()
  const { loadCollections, loadGroups } = useCollectionStore()

  useEffect(() => {
    const u1 = listen('menu-check-update', () => {
      navigate('/settings')
      requestAnimationFrame(() => window.dispatchEvent(new Event('trigger-update-check')))
    })
    const u2 = listen('menu-export-cases', async () => {
      try {
        const json = await invoke<string>('export_all_cases')
        const path = await save({ defaultPath: 'qai-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
        if (path) {
          await writeTextFile(path, json)
          toast.success(`已导出到 ${path}`)
        }
      } catch (e: unknown) { toast.error(invokeErrorMessage(e)) }
    })
    const u3 = listen<string>('menu-import-cases', async (event) => {
      const mode = event.payload
      const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false })
      if (!path) return
      try {
        const json = await readTextFile(path as string)
        const stats = await invoke<{
          createdCollections: number; updatedCollections: number
          createdItems: number; updatedItems: number
          createdAssertions: number; createdGroups: number
          createdEnvironments: number; createdEnvVariables: number
        }>('import_cases', { json, mode })
        const c = stats.createdCollections + stats.createdItems + stats.createdAssertions + stats.createdGroups + stats.createdEnvironments + stats.createdEnvVariables
        if (c > 0) {
          const parts: string[] = []
          if (stats.createdCollections) parts.push(`${stats.createdCollections} 集合`)
          if (stats.createdItems) parts.push(`${stats.createdItems} 请求`)
          if (stats.createdAssertions) parts.push(`${stats.createdAssertions} 断言`)
          if (stats.createdEnvironments) parts.push(`${stats.createdEnvironments} 环境`)
          toast.success(`导入完成，新增：${parts.join(', ')}`)
        } else {
          toast.success('导入完成，数据无变化')
        }
        // 延迟刷新页面，确保 toast 可见 + 所有缓存数据重载
        setTimeout(() => window.location.reload(), 800)
      } catch (e: unknown) { toast.error(invokeErrorMessage(e)) }
    })
    return () => { u1.then((fn) => fn()); u2.then((fn) => fn()); u3.then((fn) => fn()) }
  }, [navigate, loadCollections, loadGroups])
  return null
}

export default function App() {
  const resolved = useThemeStore((s) => s.resolved)
  const init = useThemeStore((s) => s.init)
  useEffect(() => { init(); initConsoleListener() }, [init])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster theme={resolved} position="top-right" richColors />
        <ConfirmDialog />
        <ShortcutHelpProvider />
        <MenuListener />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<WorkbenchView />} />
            <Route path="/environments" element={<Suspense fallback={<RouteFallback />}><EnvironmentsView /></Suspense>} />
            <Route path="/history" element={<Suspense fallback={<RouteFallback />}><HistoryView /></Suspense>} />
            <Route path="/settings" element={<Suspense fallback={<RouteFallback />}><SettingsView /></Suspense>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
