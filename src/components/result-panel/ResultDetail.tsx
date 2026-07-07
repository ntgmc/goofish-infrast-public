import { formatCompactNumber, type PreparedResult } from './formatters'
import DroneSummary from './DroneSummary'

export default function ResultDetail({
  isRotationMode,
  prepared,
  planTimes,
}: {
  isRotationMode: boolean;
  prepared: PreparedResult;
  planTimes?: string;
}) {
  const { plans, detailStats } = prepared

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex items-center justify-between gap-4 border-b border-surface-3/60 px-5 py-4 text-sm font-semibold text-ink-primary sm:px-6">
        <span>{isRotationMode ? '预设队列' : '排班详情'}</span>
        <span className="text-xs font-medium text-ink-muted">
          {planTimes ?? `${detailStats.planCount} 个班次`}，{detailStats.roomCount} 个房间
        </span>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        {plans.map((plan, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-surface-1">
            <div className="flex items-center justify-between bg-surface-2/50 px-6 py-4">
              <div>
                <span className="font-semibold text-ink-primary">
                  {plan.name || `班次 ${i + 1}`}
                </span>
                {plan.shift_hours && (
                  <span className="ml-2 text-xs font-medium text-ink-muted">
                    {formatCompactNumber(plan.shift_hours)}h
                  </span>
                )}
              </div>
              {!isRotationMode && plan.Fiammetta?.enable && plan.Fiammetta.target && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                  菲亚梅塔 → {plan.Fiammetta.target}
                </span>
              )}
            </div>

            <div className="px-4 py-3 sm:px-6 sm:py-4">
              <div className="hidden grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_minmax(120px,0.8fr)] gap-4 border-b border-surface-3/60 pb-2 text-xs font-medium text-ink-muted md:grid">
                <span>房间</span>
                <span>产物</span>
                <span>干员</span>
                <span className="text-right">{isRotationMode ? '轮换' : '效率'}</span>
              </div>
              {plan.rows.map((row) => (
                <div
                  key={row.key}
                  className="border-t border-surface-3/50 py-3 first:border-0 md:grid md:grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_minmax(120px,0.8fr)] md:items-center md:gap-4 md:first:border-t"
                >
                  <div className="flex items-center justify-between gap-3 md:block">
                    <span className="text-sm font-medium text-ink-secondary">
                      {row.label}
                      {row.indexLabel && (
                        <span className="ml-1 text-ink-muted">{row.indexLabel}</span>
                      )}
                    </span>
                    <span className="text-xs text-ink-muted md:hidden">{row.product}</span>
                  </div>
                  <div className="hidden text-sm text-ink-muted md:block">
                    {row.product}
                  </div>
                  <div className="mt-1 min-w-0 text-sm leading-6 text-ink-primary md:mt-0">
                    {row.operators}
                  </div>
                  <div className="mt-2 md:mt-0 md:text-right">
                    <div className="text-sm font-semibold text-brand-400 md:font-mono">
                      {isRotationMode ? '快速切换' : row.efficiency}
                    </div>
                    {!isRotationMode && row.hasAdjustedSpeed && (
                      <div className="mt-0.5 text-xs text-ink-muted">
                        速度 {row.speedEfficiency}
                      </div>
                    )}
                    {row.detail && (
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {row.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {!isRotationMode && plan.drones?.enable && <DroneSummary drones={plan.drones} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
