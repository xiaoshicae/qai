import { useState, useEffect } from 'react'
import { Moon, Sun, Monitor, Globe, Info, RefreshCw, Download, Loader2, CheckCircle2 } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { changeLanguage } from '@/i18n'
import { Button } from '@/components/ui/button'
import AIConfigSection from './settings-ai-config'

const THEME_OPTIONS = [
  { id: 'dark', label: 'dark', icon: Moon },
  { id: 'light', label: 'light', icon: Sun },
  { id: 'system', label: 'system', icon: Monitor },
] as const

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error'

export default function SettingsView() {
  const { t, i18n } = useTranslation()
  const themeMode = useThemeStore((s) => s.mode)
  const setThemeMode = useThemeStore((s) => s.setMode)

  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [newVersion, setNewVersion] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(0)

  useEffect(() => { getVersion().then(setAppVersion) }, [])

  const checkForUpdate = async () => {
    setUpdateStatus('checking')
    try {
      const update = await check()
      if (update) {
        setNewVersion(update.version)
        setUpdateStatus('available')

        let downloaded = 0
        let total = 0
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started' && event.data.contentLength) {
            total = event.data.contentLength
            setUpdateStatus('downloading')
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength
            if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100))
          } else if (event.event === 'Finished') {
            setUpdateStatus('ready')
          }
        })
        setUpdateStatus('ready')
      } else {
        setUpdateStatus('latest')
      }
    } catch (e: unknown) {
      // endpoint 404（尚未发布带签名的 Release）视为"已是最新"
      const msg = String(e).toLowerCase()
      if (msg.includes('404') || msg.includes('not found') || msg.includes('network')) {
        setUpdateStatus('latest')
      } else {
        setUpdateStatus('error')
      }
    }
  }

  const handleRestart = async () => {
    await relaunch()
  }

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

        {/* 关于与更新 */}
        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-overlay/[0.06]">
              <Info className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">{t('settings.about')}</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('settings.current_version')}</span>
                <div className="text-sm font-mono font-medium">v{appVersion}</div>
              </div>

              {updateStatus === 'ready' ? (
                <Button size="sm" onClick={handleRestart} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  {t('settings.update_restart')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={checkForUpdate}
                  disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                  className="gap-1.5"
                >
                  {updateStatus === 'checking' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {updateStatus === 'checking' ? t('settings.checking_update') : t('settings.check_update')}
                </Button>
              )}
            </div>

            {updateStatus === 'available' && (
              <div className="flex items-center gap-2 text-xs text-info">
                <Download className="h-3.5 w-3.5" />
                {t('settings.update_available', { version: newVersion })}
              </div>
            )}
            {updateStatus === 'downloading' && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{t('settings.update_downloading', { progress: downloadProgress })}</div>
                <div className="h-1.5 rounded-full bg-overlay/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
              </div>
            )}
            {updateStatus === 'ready' && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('settings.update_ready')}
              </div>
            )}
            {updateStatus === 'latest' && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('settings.update_latest')}
              </div>
            )}
            {updateStatus === 'error' && (
              <div className="text-xs text-error">{t('settings.update_error')}</div>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
