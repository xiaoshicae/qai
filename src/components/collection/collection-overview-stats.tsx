import { StatCard } from './collection-overview-edit-parts'

interface Props {
  total: number
  passed: number
  failed: number
  passRate: number
}

/** 4 个统计卡（TOTAL / PASSED / FAILED / PASS RATE） */
export function CollectionOverviewStats({ total, passed, failed, passRate }: Props) {
  const ran = passed + failed
  const rateColor =
    passRate === 100 ? 'var(--color-success)' :
    passRate >= 60 ? 'var(--color-warning)' :
    ran === 0 ? 'inherit' : 'var(--color-error)'
  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard label="TOTAL" value={total} />
      <StatCard label="PASSED" value={passed} color="text-success" />
      <StatCard label="FAILED" value={failed} color="text-error" />
      <div className="rounded-xl border border-overlay/[0.06] px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PASS RATE</span>
        <div className="text-xl font-bold tabular-nums mt-0.5 text-success" style={{ color: rateColor }}>
          {ran > 0 ? `${passRate}%` : '-'}
        </div>
        {ran > 0 && (
          <div className="mt-1.5 h-1.5 rounded-full bg-overlay/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${passRate}%`, background: rateColor }} />
          </div>
        )}
      </div>
    </div>
  )
}
