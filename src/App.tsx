import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import AppLayout from './components/layout/app-layout'
import WorkbenchView from './views/workbench-view'
import RunnerView from './views/runner-view'
import SettingsView from './views/settings-view'
import EnvironmentsView from './views/environments-view'
import HistoryView from './views/history-view'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster theme="dark" position="top-right" richColors />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<WorkbenchView />} />
          <Route path="/runner" element={<RunnerView />} />
          <Route path="/environments" element={<EnvironmentsView />} />
          <Route path="/history" element={<HistoryView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
