import { useMemo } from 'react'
import { formatCompactNumber, type PreparedResult } from './formatters'
import DroneSummary from './DroneSummary'
import OperatorAvatarStrip from './OperatorAvatarStrip'
import type { PreparedPlan, RoomRow } from './types'

type RotationRoomGroup = {
  key: string;
  label: string;
  indexLabel: string;
  product: string;
  rows: RoomRow[];
}

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
  const rotationGroups = useMemo(
    () => isRotationMode ? buildRotationRoomGroups(plans) : [],
    [isRotationMode, plans],
  )
  const displayedRoomCount = isRotationMode ? rotationGroups.length : detailStats.roomCount

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex items-center justify-between gap-4 border-b border-surface-3/60 px-5 py-4 text-sm font-semibold text-ink-primary sm:px-6">
        <span>{isRotationMode ? '预设队列' : '排班详情'}</span>
        <span className="text-xs font-medium text-ink-muted">
          {planTimes ?? `${detailStats.planCount} 个${isRotationMode ? '队列' : '班次'}`}，{displayedRoomCount} 个房间
        </span>
      </div>
      <div className="p-4 sm:p-5">
        {isRotationMode
          ? <RotationRoomGrid groups={rotationGroups} />
          : <MaaPlanList plans={plans} />}
      </div>
    </section>
  )
}

function MaaPlanList({ plans }: { plans: PreparedPlan[] }) {
  return (
    <div className="space-y-5">
      {plans.map((plan, i) => (
        <div key={`${plan.name || 'plan'}-${i}`} className="overflow-hidden rounded-xl bg-surface-1">
          <div className="flex flex-col gap-2 bg-surface-2/50 px-3 py-3 sm:px-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <span className="font-semibold text-ink-primary">
                {plan.name || `班次 ${i + 1}`}
              </span>
              {plan.shift_hours && (
                <span className="ml-2 text-xs font-medium text-ink-muted">
                  {formatCompactNumber(plan.shift_hours)}h
                </span>
              )}
            </div>
            {plan.Fiammetta?.enable && plan.Fiammetta.target && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                菲亚梅塔 → {plan.Fiammetta.target}
              </span>
            )}
          </div>

          <div className="px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="hidden grid-cols-[minmax(116px,0.8fr)_minmax(92px,0.55fr)_minmax(0,2fr)_minmax(150px,0.9fr)] gap-4 border-b border-surface-3/60 pb-2 text-xs font-medium text-ink-muted md:grid">
              <span>房间</span>
              <span>产物</span>
              <span>干员</span>
              <span className="text-right">效率</span>
            </div>
            <div className="divide-y divide-surface-3/50 md:divide-y-0">
              {plan.rows.map((row) => (
                <MaaRoomRow key={row.key} row={row} />
              ))}
            </div>

            {plan.drones?.enable && <DroneSummary drones={plan.drones} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function MaaRoomRow({ row }: { row: RoomRow }) {
  return (
    <div className="py-3 first:pt-1 last:pb-1 md:grid md:grid-cols-[minmax(116px,0.8fr)_minmax(92px,0.55fr)_minmax(0,2fr)_minmax(132px,0.8fr)] md:items-start md:gap-3 md:border-t md:border-surface-3/50 md:first:border-t">
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
      <div className="mt-3 min-w-0 md:mt-0">
        {row.isAutofill ? (
          <div className="rounded-lg border border-surface-3/70 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-secondary">
            {row.operatorText}
            {row.detail && <span className="mt-1 block text-xs text-ink-muted">{row.detail}</span>}
          </div>
        ) : (
          <OperatorAvatarStrip operators={row.operators} fallbackText={row.operatorText} compact />
        )}
      </div>
      <div className="mt-3 md:mt-0 md:text-right">
        {!row.isAutofill && (
          <>
            <div className="inline-flex rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-400 md:font-mono">
              {row.efficiency}
            </div>
            <EfficiencyDisclosure row={row} />
          </>
        )}
      </div>
    </div>
  )
}

function RotationRoomGrid({ groups }: { groups: RotationRoomGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-surface-3 bg-surface-0 px-4 py-8 text-center text-sm text-ink-muted">
        暂无可展示的预设队列。
      </div>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {groups.map((group) => (
        <article key={group.key} className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
          <div className="flex items-start justify-between gap-3 border-b border-surface-3/60 bg-surface-2/50 px-3 py-2.5">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-ink-primary">
                {group.label}
                {group.indexLabel && <span className="ml-1 text-ink-muted">{group.indexLabel}</span>}
              </h3>
              <p className="mt-1 truncate text-xs text-ink-muted">{group.product}</p>
            </div>
            <span className="shrink-0 rounded-full bg-surface-0 px-2.5 py-1 text-xs font-semibold text-ink-secondary">
              {group.rows.length} 队列
            </span>
          </div>
          <div className="divide-y divide-surface-3/60">
            {group.rows.map((row) => (
              <div key={row.key} className="px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-400">
                    {row.queueLabel}
                  </span>
                  <span className="text-xs font-medium text-ink-muted">快速切换</span>
                </div>
                <div className="mt-2">
                  <OperatorAvatarStrip operators={row.operators} fallbackText={row.operatorText} compact />
                </div>
                <EfficiencyDisclosure row={row} compact />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function EfficiencyDisclosure({ row, compact = false }: { row: RoomRow; compact?: boolean }) {
  const detailItems = row.detailItems.length > 0 ? row.detailItems : ['暂无额外效率数据']

  return (
    <details className={`group ${compact ? 'mt-3' : 'mt-2'} rounded-lg border border-surface-3/70 bg-surface-0/80 text-left`}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/45 [&::-webkit-details-marker]:hidden">
        <span>效率数据</span>
        <span className="inline-flex items-center gap-2 text-ink-muted">
          {row.efficiency}
          <svg
            className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </summary>
      <ul className="space-y-1 border-t border-surface-3/60 px-2.5 py-2.5 text-xs leading-5 text-ink-muted">
        {detailItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  )
}

function buildRotationRoomGroups(plans: PreparedPlan[]): RotationRoomGroup[] {
  const groups = new Map<string, RotationRoomGroup>()

  for (const plan of plans) {
    for (const row of plan.rows) {
      const key = `${row.roomType}-${row.roomIndex}`
      const existing = groups.get(key)
      if (existing) {
        existing.rows.push(row)
        existing.product = formatGroupProduct(existing.rows)
        continue
      }

      groups.set(key, {
        key,
        label: row.label,
        indexLabel: row.indexLabel,
        product: row.product,
        rows: [row],
      })
    }
  }

  return [...groups.values()]
}

function formatGroupProduct(rows: RoomRow[]): string {
  const products = Array.from(new Set(rows.map((row) => row.product).filter((product) => product && product !== '-')))
  if (products.length === 0) return '-'
  if (products.length <= 2) return products.join(' / ')
  return '多产物'
}
