import { useTranslation } from 'react-i18next'
import { X, Command, CornerDownLeft } from 'lucide-react'
import { useEffect, useCallback } from 'react'

const SHORTCUTS = [
  {
    category: 'navigation',
    items: [
      { keys: ['⌘', '1-4'], labelKey: 'shortcuts.switch_view' },
      { keys: ['⌘', 'K'], labelKey: 'shortcuts.focus_search' },
      { keys: ['⌘', 'B'], labelKey: 'shortcuts.toggle_sidebar' },
    ],
  },
  {
    category: 'actions',
    items: [
      { keys: ['⌘', 'N'], labelKey: 'shortcuts.new_request' },
      { keys: ['⌘', 'Enter'], labelKey: 'shortcuts.send_request' },
      { keys: ['?'], labelKey: 'shortcuts.show_help' },
    ],
  },
  {
    category: 'editor',
    items: [
      { keys: ['⌘', 'S'], labelKey: 'shortcuts.save' },
      { keys: ['Esc'], labelKey: 'shortcuts.close_dialog' },
    ],
  },
]

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md bg-overlay/[0.06] text-[11px] font-mono text-muted-foreground border border-overlay/[0.08]">
      {children}
    </span>
  )
}

function KeySequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="flex items-center gap-1">
          {key === '⌘' && <Command className="h-3 w-3" />}
          {key === 'Enter' && <CornerDownLeft className="h-3 w-3" />}
          {key !== '⌘' && key !== 'Enter' && <KeyBadge>{key}</KeyBadge>}
          {i < keys.length - 1 && <span className="text-muted-foreground/40 mx-0.5">+</span>}
        </span>
      ))}
    </div>
  )
}

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const { t } = useTranslation()

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          className="relative z-50 w-full max-w-md glass-card rounded-2xl p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">{t('shortcuts.title')}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-overlay/[0.06] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="space-y-4">
            {SHORTCUTS.map((group) => (
              <div key={group.category}>
                <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
                  {t(`shortcuts.category_${group.category}`)}
                </div>
                <div className="space-y-2">
                  {group.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t(item.labelKey)}</span>
                      <KeySequence keys={item.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-overlay/[0.06]">
            <p className="text-[10px] text-muted-foreground/50 text-center">
              {t('shortcuts.hint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Store for managing help panel state
import { create } from 'zustand'

interface ShortcutHelpState {
  open: boolean
  openHelp: () => void
  closeHelp: () => void
  toggleHelp: () => void
}

export const useShortcutHelpStore = create<ShortcutHelpState>((set) => ({
  open: false,
  openHelp: () => set({ open: true }),
  closeHelp: () => set({ open: false }),
  toggleHelp: () => set((s) => ({ open: !s.open })),
}))

export function ShortcutHelpProvider() {
  const { open, closeHelp } = useShortcutHelpStore()
  return <ShortcutHelp open={open} onClose={closeHelp} />
}
