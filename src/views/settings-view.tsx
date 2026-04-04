import { Moon, Sun, Monitor, Globe } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/i18n'
import AIConfigSection from './settings-ai-config'

const THEME_OPTIONS = [
  { id: 'dark', label: 'dark', icon: Moon },
  { id: 'light', label: 'light', icon: Sun },
  { id: 'system', label: 'system', icon: Monitor },
] as const

export default function SettingsView() {
  const { t, i18n } = useTranslation()
  const themeMode = useThemeStore((s) => s.mode)
  const setThemeMode = useThemeStore((s) => s.setMode)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-8 py-6 pb-12 space-y-6">

        {/* 外观 */}
        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-overlay/[0.06]">
              <Globe className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">{t('settings.appearance')}</h2>
          </div>

          {/* 主题 */}
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('settings.theme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((opt) => {
                const active = themeMode === opt.id
                const Icon = opt.icon
                return (
                  <button
                    key={opt.id}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-all duration-200 text-xs font-medium ${
                      active
                        ? 'btn-gradient text-primary-foreground shadow-lg'
                        : 'bg-overlay/[0.04] text-foreground/70 hover:bg-overlay/[0.08] border border-overlay/[0.06] hover:border-overlay/[0.1]'
                    }`}
                    onClick={() => setThemeMode(opt.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t(`settings.${opt.label}`)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="h-px bg-overlay/[0.06] my-5" />

          {/* 语言 */}
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('settings.language')}</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }].map((lang) => {
                const active = i18n.language === lang.id
                return (
                  <button
                    key={lang.id}
                    className={`flex items-center justify-center py-2.5 rounded-xl cursor-pointer transition-all duration-200 text-xs font-medium ${
                      active
                        ? 'btn-gradient text-primary-foreground shadow-lg'
                        : 'bg-overlay/[0.04] text-foreground/70 hover:bg-overlay/[0.08] border border-overlay/[0.06] hover:border-overlay/[0.1]'
                    }`}
                    onClick={() => changeLanguage(lang.id)}
                  >
                    {lang.label}
                  </button>
                )
              })}
            </div>
          </div>

        </section>

        {/* AI 配置 */}
        <AIConfigSection />

      </div>
    </div>
  )
}
