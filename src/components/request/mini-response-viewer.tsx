import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { JsonHighlight } from '@/components/ui/json-highlight'
import { formatDuration, formatSize } from '@/lib/formatters'
import type { ExecutionResult } from '@/types'

interface Props {
  result: ExecutionResult
  /** 外层 className，用于控制尺寸（如 flex-1 min-h-0） */
  className?: string
}

export function MiniResponseViewer({ result, className = '' }: Props) {
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  const [copied, setCopied] = useState(false)
  const resp = result.response

  const copyBody = async () => {
    if (!resp) return
    await navigator.clipboard.writeText(resp.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`rounded-xl border border-overlay/[0.06] bg-overlay/[0.02] overflow-hidden text-xs flex flex-col ${className}`}>
      {/* Tab bar — fixed */}
      <div className="flex items-center justify-between border-b border-overlay/[0.06] px-3 shrink-0">
        <div className="flex items-center gap-0">
          <RespTab active={tab === 'body'} onClick={() => setTab('body')}>Body</RespTab>
          <RespTab active={tab === 'headers'} onClick={() => setTab('headers')}>
            Headers{resp ? ` (${resp.headers.length})` : ''}
          </RespTab>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono font-medium ${result.status === 'success' ? 'text-emerald-500' : 'text-destructive'}`}>
            {resp ? `${resp.status}` : result.status}
          </span>
          {resp && (
            <>
              <span className="text-muted-foreground">{formatDuration(resp.time_ms)}</span>
              <span className="text-muted-foreground">{formatSize(resp.size_bytes)}</span>
              <button
                type="button"
                onClick={copyBody}
                className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-overlay/[0.06] cursor-pointer transition-colors"
                title="Copy response body"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>
      </div>
      {result.error_message && (
        <div className="px-3 py-2 text-destructive border-b border-overlay/[0.06] shrink-0">{result.error_message}</div>
      )}
      {/* Content — scrollable, fills remaining space */}
      {resp && tab === 'body' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <PrettyBody body={resp.body} />
        </div>
      )}
      {resp && tab === 'headers' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-overlay/[0.04]">
                <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-1/3">Key</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Value</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {resp.headers.map((h, i) => (
                <tr key={i} className="border-b border-overlay/[0.02] hover:bg-overlay/[0.03] transition-colors">
                  <td className="px-3 py-1 text-primary/80 align-top">{h.key}</td>
                  <td className="px-3 py-1 text-muted-foreground break-all">{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RespTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors relative ${
        active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'
      }`}
      onClick={onClick}
    >
      {children}
      {active && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />}
    </button>
  )
}

function PrettyBody({ body }: { body: string }) {
  try {
    const parsed = JSON.parse(body)
    return <JsonHighlight code={JSON.stringify(parsed, null, 2)} />
  } catch {
    return <JsonHighlight code={body} />
  }
}
