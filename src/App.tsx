import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import AppLayout from './components/layout/app-layout'
import WorkbenchView from './views/workbench-view'
import SettingsView from './views/settings-view'
import EnvironmentsView from './views/environments-view'
import HistoryView from './views/history-view'
import { ConfirmDialog } from './components/ui/confirm-dialog'
import { useThemeStore } from './stores/theme-store'

export default function App() {
  const resolved = useThemeStore((s) => s.resolved)
  const init = useThemeStore((s) => s.init)
  useEffect(() => { init() }, [])

  return (
    <BrowserRouter>
      <Toaster theme={resolved} position="top-right" richColors />
      <ConfirmDialog />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<WorkbenchView />} />
          <Route path="/environments" element={<EnvironmentsView />} />
          <Route path="/history" element={<HistoryView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
