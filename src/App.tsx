import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import AppLayout from './components/layout/app-layout'
import WorkbenchView from './views/workbench-view'
import { ConfirmDialog } from './components/ui/confirm-dialog'
import { ShortcutHelpProvider } from './components/ui/shortcut-help'
import { ErrorBoundary } from './components/ui/error-boundary'
import { useThemeStore } from './stores/theme-store'
import { initConsoleListener } from './stores/console-store'

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
