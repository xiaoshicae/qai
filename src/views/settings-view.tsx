import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Eye, EyeOff, Check, Loader2, Wifi, WifiOff, ExternalLink, Save } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const PROVIDERS = [
  { id: 'claude', label: 'Claude', icon: 'A' },
  { id: 'openai', label: 'OpenAI', icon: 'O' },
  { id: 'gemini', label: 'Gemini', icon: 'G' },
  { id: 'other', label: '其它', icon: '…' },
] as const

const MODEL_OPTIONS: Record<string, { label: string; value: string; badge?: string }[]> = {
  claude: [
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514', badge: '推荐' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514', badge: '最强' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001', badge: '最快' },
  ],
  openai: [
    { label: 'GPT-5', value: 'gpt-5', badge: '最强' },
    { label: 'GPT-5 mini', value: 'gpt-5-mini', badge: '推荐' },
    { label: 'GPT-4.1', value: 'gpt-4.1', badge: '经济' },
    { label: 'o3-pro', value: 'o3-pro', badge: '推理' },
    { label: 'o4-mini', value: 'o4-mini', badge: '推理' },
  ],
  gemini: [
    { label: 'Gemini 3 Pro', value: 'gemini-3-pro', badge: '最强' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash', badge: '推荐' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro', badge: '经济' },
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

  // 判断是否有未保存的修改
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
      setTestError(typeof e === 'string' ? e : e.message ?? '连接失败')
    }
  }

  if (!loaded) return null

  return (
    <div className="mx-auto max-w-lg px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">设置</h1>

      <div className="space-y-3">
        {/* 提供商 */}
        <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4 space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI 提供商</label>
          <div className="grid grid-cols-4 gap-2">
            {PROVIDERS.map((p) => {
              const active = provider === p.id
              const isSaved = savedProvider === p.id
              return (
                <button
                  key={p.id}
                  className={`relative flex flex-col items-center gap-1 py-3 rounded-lg cursor-pointer transition-all ${
                    active
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/50'
                      : 'bg-muted/50 text-foreground hover:bg-muted ring-1 ring-transparent'
                  }`}
                  onClick={() => handleProviderChange(p.id)}
                >
                  <span className={`text-base font-bold leading-none ${active ? '' : 'text-muted-foreground'}`}>{p.icon}</span>
                  <span className="text-[11px] font-medium">{p.label}</span>
                  {isSaved && (
                    <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} title="当前使用" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* API Key */}
        <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
            {apiKey && effectiveModel && (
              <button
                className={`flex items-center gap-1 text-[11px] cursor-pointer transition-colors ${
                  testStatus === 'success' ? 'text-emerald-500' :
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
                 testStatus === 'error' ? '连接失败' : '测试连通'}
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={KEY_HINTS[provider] ?? 'API Key'}
              className="pr-10 font-mono text-xs dark:bg-input/30"
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer p-0.5 rounded"
              onClick={() => setShowKey(!showKey)}
              tabIndex={-1}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {testStatus === 'error' && (
            <p className="text-[11px] text-destructive leading-relaxed break-all">{testError}</p>
          )}
        </div>

        {/* 模型 */}
        <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4 space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">模型</label>
          {modelOptions.length > 0 ? (
            <div className="space-y-1">
              {modelOptions.map((m) => {
                const active = model === m.value
                return (
                  <div
                    key={m.value}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                      active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/70'
                    }`}
                    onClick={() => handleModelChange(m.value)}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                      active ? 'border-primary bg-primary scale-110' : 'border-muted-foreground/25'
                    }`}>
                      {active && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
                    </div>
                    <span className={`text-[13px] flex-1 ${active ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
                      {m.label}
                    </span>
                    {m.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground/60'
                      }`}>{m.badge}</span>
                    )}
                  </div>
                )
              })}
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                onBlur={handleCustomModelBlur}
                placeholder="自定义模型 ID..."
                className="mt-1.5 text-xs font-mono dark:bg-input/30"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={model}
                onChange={(e) => setModels((prev) => ({ ...prev, [provider]: e.target.value }))}
                placeholder="输入模型 ID，如 deepseek-chat"
                className="text-xs font-mono dark:bg-input/30"
              />
              {provider === 'other' && (
                <>
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    Base URL
                    <ExternalLink className="h-3 w-3" />
                  </label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className="text-xs font-mono dark:bg-input/30"
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* 保存按钮 */}
        <Button
          onClick={handleSave}
          disabled={saving || (!hasChanges && !justSaved)}
          className="w-full gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? '保存中...' : justSaved ? '已保存' : hasChanges ? '保存设置' : '已保存'}
        </Button>
      </div>
    </div>
  )
}
