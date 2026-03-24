import { useState } from 'react'
import { Sparkles, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCollectionStore } from '@/stores/collection-store'

interface AIGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AIGenerateDialog({ open, onOpenChange }: AIGenerateDialogProps) {
  const { collections, loadTree } = useCollectionStore()
  const [selectedId, setSelectedId] = useState('')
  const [context, setContext] = useState('')
  const [extraInstructions, setExtraInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    if (!selectedId || !context.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await invoke<{ count: number; message: string }>('ai_generate_tests', {
        collectionId: selectedId, context, extraInstructions,
      })
      setResult(res.message)
      await loadTree(selectedId)
    } catch (e: any) {
      setError(typeof e === 'string' ? e : e.message ?? '生成失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI 生成测试用例
          </DialogTitle>
        </DialogHeader>
        <DialogClose onClose={() => onOpenChange(false)} />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">目标集合</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm cursor-pointer outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">选择目标集合</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API 代码或文档</label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={"粘贴 API 代码或文档...\n\n例如 Flask/FastAPI/Express 路由代码、OpenAPI 文档、或 API 端点描述"}
              rows={8}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">额外要求（可选）</label>
            <Input
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="例如 '重点测试权限验证' '基础 URL 是 http://localhost:8000'"
            />
          </div>

          <Button onClick={generate} disabled={loading || !selectedId || !context.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'AI 正在分析...' : '生成测试用例'}
          </Button>

          {result && (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-500">
              <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{result}</p>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
