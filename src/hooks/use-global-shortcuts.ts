import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isShortcutTarget } from '@/lib/utils'
import { useShortcutHelpStore } from '@/components/ui/shortcut-help'

const ROUTES = ['/', '/history', '/environments', '/settings']

export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleHelp = useShortcutHelpStore((s) => s.toggleHelp)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // ⌘+1/2/3/4 — switch views
      if (mod && e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1
        if (idx < ROUTES.length && location.pathname !== ROUTES[idx]) {
          e.preventDefault()
          navigate(ROUTES[idx])
        }
        return
      }

      // ⌘+K — focus sidebar search
      if (mod && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('[data-sidebar-search]')
        searchInput?.focus()
        return
      }

      // ? — toggle help panel (when not in input)
      if (e.key === '?' && !mod) {
        if (!isShortcutTarget(e.target)) {
          e.preventDefault()
          toggleHelp()
        }
        return
      }

      // Don't intercept when focused on inputs (except ⌘+K and ⌘+number)
      if (isShortcutTarget(e.target)) return

      // ⌘+N — new request (dispatch custom event for sidebar to handle)
      if (mod && e.key === 'n') {
        e.preventDefault()
        window.dispatchEvent(new Event('qai:new-request'))
        return
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [navigate, location.pathname, toggleHelp])
}
