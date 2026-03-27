import { CheckCircle, XCircle } from 'lucide-react'
import type { AssertionResultItem } from '@/types'

export default function AssertionResult({ results }: { results: AssertionResultItem[] }) {
  if (results.length === 0) {
    return <div className="text-muted-foreground text-sm text-center py-6">暂无断言结果</div>
  }

  return (
    <div className="rounded-xl border border-overlay/[0.06] overflow-hidden">
      {results.map((r, i) => (
        <div
          key={r.assertion_id}
          className={`flex items-start gap-2.5 px-4 py-2.5 ${i % 2 === 0 ? 'bg-card' : 'bg-transparent'}`}
        >
          {r.passed
            ? <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            : <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="text-sm">{r.message}</div>
            {!r.passed && r.actual && (
              <div className="text-xs text-muted-foreground mt-0.5">
                实际值: <code className="text-red-500 bg-red-500/10 px-1 py-0.5 rounded text-xs">{r.actual}</code>
              </div>
            )}
          </div>
          <span className={`text-[10px] font-bold tracking-wider shrink-0 ${r.passed ? 'text-emerald-500' : 'text-red-500'}`}>
            {r.passed ? 'PASS' : 'FAIL'}
          </span>
        </div>
      ))}
    </div>
  )
}
