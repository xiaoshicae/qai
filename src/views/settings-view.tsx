import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Eye, EyeOff, Check, Loader2, Wifi, WifiOff, ExternalLink, Save, Moon, Sun, Monitor, Globe, Bot } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/theme-store'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/i18n'

const PROVIDERS = [
  { id: 'claude', label: 'Claude', icon: 'A' },
  { id: 'openai', label: 'OpenAI', icon: 'O' },
  { id: 'gemini', label: 'Gemini', icon: 'G' },
  { id: 'other', label: 'other', icon: '…' },
] as const

const MODEL_OPTIONS: Record<string, { label: string; value: string; badge?: string }[]> = {
  claude: [
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514', badge: 'recommended' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514', badge: 'strongest' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001', badge: 'fastest' },
  ],
  openai: [
    { label: 'GPT-5', value: 'gpt-5', badge: 'strongest' },
    { label: 'GPT-5 mini', value: 'gpt-5-mini', badge: 'recommended' },
    { label: 'GPT-4.1', value: 'gpt-4.1', badge: 'economy' },
    { label: 'o3-pro', value: 'o3-pro', badge: 'reasoning' },
    { label: 'o4-mini', value: 'o4-mini', badge: 'reasoning' },
  ],
  gemini: [
    { label: 'Gemini 3 Pro', value: 'gemini-3-pro', badge: 'strongest' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash', badge: 'recommended' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro', badge: 'economy' },
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
  ],
  other: [],
}

const DEFAULT_MODELS: Record<string, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-5-mini',
  gemini: 'gemini-3-flash',
  other: '',
}

const KEY_HINTS: Record<string, string> = {
  claude: 'sk-ant-...',
  openai: 'sk-...',
  gemini: 'AIza...',
  other: 'Bearer token...',
}

const THEME_OPTIONS = [
  { id: 'dark', label: 'dark', icon: Moon },
  { id: 'light', label: 'light', icon: Sun },
  { id: 'system', label: 'system', icon: Monitor },
] as const

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

async function getSetting(key: string): Promise<string> {
  try {
    return (await invoke<string | null>('get_setting_cmd', { key })) ?? ''
  } catch { return '' }
}

async function putSetting(key: string, value: string) {
  try { await invoke('save_setting', { key, value }) } catch {}
}

export default function SettingsView() {
  const { t, i18n } = useTranslation()
  const themeMode = useThemeStore((s) => s.mode)
  const setThemeMode = useThemeStore((s) => s.setMode)
  const [provider, setProvider] = useState('claude')
  const [savedProvider, setSavedProvider] = useState('claude')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string>>({})
  const [savedModels, setSavedModels] = useState<Record<string, string>>({})
  const [customModel, setCustomModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [savedBaseUrl, setSavedBaseUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    (async () => {
      const p = await getSetting('ai_provider') || 'claude'
      const loadedKeys: Record<string, string> = {}
      const loadedModels: Record<string, string> = {}
      for (const prov of PROVIDERS) {
        loadedKeys[prov.id] = await getSetting(`ai_api_key_${prov.id}`)
        loadedModels[prov.id] = await getSetting(`ai_model_${prov.id}`) || DEFAULT_MODELS[prov.id]
      }
      if (!loadedKeys.claude) {
        const oldKey = await getSetting('ai_api_key') || await getSetting('claude_api_key')
        if (oldKey) loadedKeys.claude = oldKey
      }
      if (!loadedModels.claude || loadedModels.claude === DEFAULT_MODELS.claude) {
        const oldModel = await getSetting('ai_model') || await getSetting('claude_model')
        if (oldModel) loadedModels.claude = oldModel
      }
      setProvider(p)
      setSavedProvider(p)
      setKeys(loadedKeys)
      setSavedKeys({ ...loadedKeys })
      setModels(loadedModels)
      setSavedModels({ ...loadedModels })
      setBaseUrl(await getSetting('ai_base_url'))
      setSavedBaseUrl(await getSetting('ai_base_url'))
      setLoaded(true)
    })()
  }, [])

  const apiKey = keys[provider] ?? ''
  const model = models[provider] ?? ''
  const modelOptions = MODEL_OPTIONS[provider] ?? []
  const effectiveModel = model || customModel.trim()

  const hasChanges =
    provider !== savedProvider ||
    apiKey !== (savedKeys[provider] ?? '') ||
    model !== (savedModels[provider] ?? '') ||
    (provider === 'other' && baseUrl !== savedBaseUrl)

  const handleProviderChange = (id: string) => {
    setProvider(id)
    setShowKey(false)
    setCustomModel('')
    setTestStatus('idle')
  }

  const setApiKey = (value: string) => {
    setKeys((prev) => ({ ...prev, [provider]: value }))
    setTestStatus('idle')
  }

  const handleModelChange = (value: string) => {
    setModels((prev) => ({ ...prev, [provider]: value }))
    setCustomModel('')
    setTestStatus('idle')
  }

  const handleCustomModelBlur = () => {
    if (customModel.trim()) {
      handleModelChange(customModel.trim())
    }
  }

  const handleSave = async () => {
    setSaving(true)
    await putSetting('ai_provider', provider)
    await putSetting(`ai_api_key_${provider}`, apiKey)
    await putSetting('ai_api_key', apiKey)
    const m = effectiveModel
    await putSetting(`ai_model_${provider}`, m)
    await putSetting('ai_model', m)
    if (provider === 'other') {
      await putSetting('ai_base_url', baseUrl)
      setSavedBaseUrl(baseUrl)
    }
    setSavedProvider(provider)
    setSavedKeys((prev) => ({ ...prev, [provider]: apiKey }))
    setSavedModels((prev) => ({ ...prev, [provider]: m }))
    setSaving(false)
    setJustSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setJustSaved(false), 800)
  }

  const testConnection = async () => {
    if (!apiKey || !effectiveModel) return
    setTestStatus('testing')
    setTestError('')
    try {
      await invoke('test_ai_connection', {
        provider, apiKey, model: effectiveModel, baseUrl: baseUrl || null,
      })
      setTestStatus('success')
    } catch (e: any) {
      setTestStatus('error')
      setTestError(typeof e === 'string' ? e : e.message ?? t('settings.connection_failed'))
    }
  }

  if (!loaded) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-8 py-6 pb-12 space-y-6">

        {/* ═══ 外观 ═══ */}
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

          {/* 分割线 */}
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

        {/* ═══ AI 配置 ═══ */}
        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-overlay/[0.06]">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">{t('settings.ai_config')}</h2>
          </div>

          {/* 提供商 */}
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('settings.provider')}</label>
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map((p) => {
                const active = provider === p.id
                const isSaved = savedProvider === p.id
                return (
                  <button
                    key={p.id}
                    className={`relative flex flex-col items-center gap-1 py-2.5 rounded-xl cursor-pointer transition-all duration-200 ${
                      active
                        ? 'btn-gradient text-primary-foreground shadow-lg'
                        : 'bg-overlay/[0.04] text-foreground/70 hover:bg-overlay/[0.08] border border-overlay/[0.06] hover:border-overlay/[0.1]'
                    }`}
                    onClick={() => handleProviderChange(p.id)}
                  >
                    <span className={`text-sm font-bold leading-none ${active ? '' : 'text-muted-foreground'}`}>{p.icon}</span>
                    <span className="text-[10px] font-medium">{p.id === 'other' ? t('settings.other') : p.label}</span>
                    {isSaved && (
                      <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-emerald-400'}`} title="当前使用" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 分割线 */}
          <div className="h-px bg-overlay/[0.06] my-5" />

          {/* API Key */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
              {apiKey && effectiveModel && (
                <button
                  className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 ${
                    testStatus === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                    testStatus === 'error' ? 'text-destructive' :
                    testStatus === 'testing' ? 'text-muted-foreground' :
                    'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={testConnection}
                  disabled={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? <Loader2 className="h-3 w-3 animate-spin" /> :
                   testStatus === 'success' ? <Wifi className="h-3 w-3" /> :
                   testStatus === 'error' ? <WifiOff className="h-3 w-3" /> :
                   <Wifi className="h-3 w-3" />}
                  {testStatus === 'testing' ? '测试中' :
                   testStatus === 'success' ? '已连通' :
                   testStatus === 'error' ? t('settings.connection_failed') : '测试连通'}
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={KEY_HINTS[provider] ?? 'API Key'}
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer p-0.5 rounded-md transition-colors"
                onClick={() => setShowKey(!showKey)}
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {testStatus === 'error' && (
              <p className="text-[11px] text-destructive/80 leading-relaxed break-all bg-destructive/5 rounded-lg px-3 py-2">{testError}</p>
            )}
          </div>

          {/* 分割线 */}
          <div className="h-px bg-overlay/[0.06] my-5" />

          {/* 模型 */}
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('settings.model')}</label>
            {modelOptions.length > 0 ? (
              <div className="space-y-1">
                {modelOptions.map((m) => {
                  const active = model === m.value
                  return (
                    <div
                      key={m.value}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 ${
                        active ? 'bg-primary/10 glow-ring' : 'hover:bg-overlay/[0.04]'
                      }`}
                      onClick={() => handleModelChange(m.value)}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all duration-200 ${
                        active ? 'border-primary bg-primary scale-110' : 'border-overlay/[0.15]'
                      }`}>
                        {active && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
                      </div>
                      <span className={`text-xs flex-1 ${active ? 'font-medium text-foreground' : 'text-foreground/70'}`}>
                        {m.label}
                      </span>
                      {m.badge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${
                          active ? 'bg-primary/15 text-primary' : 'bg-overlay/[0.06] text-muted-foreground'
                        }`}>{t(`settings.badge_${m.badge}`)}</span>
                      )}
                    </div>
                  )
                })}
                <Input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onBlur={handleCustomModelBlur}
                  placeholder="自定义模型 ID..."
                  className="mt-2 text-xs font-mono"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  value={model}
                  onChange={(e) => setModels((prev) => ({ ...prev, [provider]: e.target.value }))}
                  placeholder="输入模型 ID，如 deepseek-chat"
                  className="text-xs font-mono"
                />
                {provider === 'other' && (
                  <>
                    <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                      Base URL
                      <ExternalLink className="h-3 w-3" />
                    </label>
                    <Input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com"
                      className="text-xs font-mono"
                    />
                  </>
                )}
              </div>
            )}
          </div>

          {/* 分割线 */}
          <div className="h-px bg-overlay/[0.06] my-5" />

          {/* 保存 */}
          <Button
            onClick={handleSave}
            disabled={saving || (!hasChanges && !justSaved)}
            className="w-full gap-2 h-9"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : justSaved ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span className="text-xs">
              {saving ? t('settings.saving') : justSaved ? t('settings.saved') : hasChanges ? t('settings.save_settings') : t('settings.saved')}
            </span>
          </Button>
        </section>

      </div>
    </div>
  )
}
