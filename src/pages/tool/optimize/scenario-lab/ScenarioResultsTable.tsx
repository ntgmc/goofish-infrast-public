import { useMemo, useState } from 'react'
import type { ScenarioComparisonPoint, ScenarioMetrics } from '../../../../lib/scenario-comparison'

type SortKey = 'frontier' | 'operations' | 'sanity' | 'lmd' | 'battle' | 'goldNet'

export default function ScenarioResultsTable({
  points,
  selectedId,
  onSelect,
}: {
  points: ScenarioComparisonPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 'ascending' | 'descending' }>({ key: 'frontier', direction: 'descending' })
  const sorted = useMemo(() => [...points].sort((left, right) => compare(left, right, sort)), [points, sort])
  const changeSort = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'descending' ? 'ascending' : 'descending',
  }))

  return (
    <div>
      <div className="hidden overflow-hidden rounded-lg border border-surface-3 md:block">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-surface-2 text-ink-secondary">
            <tr>
              <Header label="场景" />
              <SortableHeader label="换班" sortKey="operations" sort={sort} onSort={changeSort} />
              <SortableHeader label="等效理智" sortKey="sanity" sort={sort} onSort={changeSort} />
              <SortableHeader label="龙门币" sortKey="lmd" sort={sort} onSort={changeSort} />
              <SortableHeader label="作战记录" sortKey="battle" sort={sort} onSort={changeSort} />
              <Header label="赤金 产/耗/净" />
              <Header label="无人机 使用/丢弃" />
              <SortableHeader label="状态" sortKey="frontier" sort={sort} onSort={changeSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3/70">
            {sorted.map((point) => {
              const value = metric(point)
              const selected = point.id === selectedId
              return (
                <tr key={point.id} className={selected ? 'bg-brand-600/10' : 'bg-surface-1 hover:bg-surface-2/70'}>
                  <td className="p-0">
                    <button type="button" onClick={() => onSelect(point.id)} className="min-h-11 w-full px-3 py-2 text-left font-medium text-ink-primary focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45">
                      <span className="block">{point.layout} · 赤{point.pureGoldLines}/经{point.battleRecordLines}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-ink-muted">{scheduleLabel(point)} · {droneLabel(point.droneStrategy)}</span>
                    </button>
                  </td>
                  <Cell value={`${point.operationsPerDay} 次`} />
                  <Cell value={value ? number(value.productionSanityPerDay) : '—'} strong />
                  <Cell value={value ? number(value.lmdPerDay) : '—'} />
                  <Cell value={value ? number(value.battleRecordPerDay) : '—'} />
                  <Cell value={value ? `${number(value.pureGoldProducedPerDay)} / ${number(value.pureGoldConsumedPerDay)} / ${signed(value.pureGoldNetPerDay)}` : '—'} />
                  <Cell value={value ? `${number(value.dronesUsedPerDay)} / ${number(value.dronesDiscardedPerDay)}` : '—'} />
                  <td className="px-3 py-2">
                    <Status point={point} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {sorted.map((point) => {
          const value = metric(point)
          return (
            <button key={point.id} type="button" onClick={() => onSelect(point.id)} className={`min-h-11 rounded-lg border p-4 text-left focus:outline-none focus:ring-2 focus:ring-brand-500/45 ${point.id === selectedId ? 'border-brand-500 bg-brand-600/10' : 'border-surface-3 bg-surface-1'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">{point.layout} · 赤金 {point.pureGoldLines} / 经验 {point.battleRecordLines}</p>
                  <p className="mt-1 text-xs text-ink-muted">{scheduleLabel(point)} · {droneLabel(point.droneStrategy)}</p>
                </div>
                <Status point={point} />
              </div>
              {value ? (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Stat label="等效理智/日" value={number(value.productionSanityPerDay)} />
                  <Stat label="换班" value={`${point.operationsPerDay} 次/日`} />
                  <Stat label="龙门币" value={number(value.lmdPerDay)} />
                  <Stat label="作战记录" value={number(value.battleRecordPerDay)} />
                  <Stat label="赤金净变动" value={signed(value.pureGoldNetPerDay)} />
                  <Stat label="无人机使用" value={number(value.dronesUsedPerDay)} />
                </dl>
              ) : <p className="mt-3 text-xs text-error">{point.error ?? '场景计算失败'}</p>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Header({ label }: { label: string }) {
  return <th scope="col" className="px-3 py-2 font-semibold">{label}</th>
}

function SortableHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; direction: 'ascending' | 'descending' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th scope="col" className="p-0" aria-sort={active ? sort.direction : 'none'}>
      <button type="button" onClick={() => onSort(sortKey)} className="min-h-11 w-full px-3 py-2 text-left font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45">
        {label}{active ? (sort.direction === 'descending' ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )
}

function Cell({ value, strong = false }: { value: string; strong?: boolean }) {
  return <td className={`px-3 py-2 tabular-nums ${strong ? 'font-semibold text-ink-primary' : 'text-ink-secondary'}`}>{value}</td>
}

function Status({ point }: { point: ScenarioComparisonPoint }) {
  const className = point.isFrontier ? 'bg-success/10 text-success' : point.verified ? 'bg-brand-600/10 text-brand-300' : point.status === 'failed' ? 'bg-error/10 text-error' : 'bg-surface-2 text-ink-muted'
  const label = point.isFrontier ? '前沿' : point.verified ? '精确' : point.status === 'failed' ? '失败' : '快速'
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${className}`}>{label}</span>
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-surface-2 px-2 py-2"><dt className="text-ink-muted">{label}</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink-primary">{value}</dd></div>
}

function metric(point: ScenarioComparisonPoint): ScenarioMetrics | undefined {
  return point.verified ?? point.screening
}

function compare(left: ScenarioComparisonPoint, right: ScenarioComparisonPoint, sort: { key: SortKey; direction: 'ascending' | 'descending' }): number {
  const direction = sort.direction === 'ascending' ? 1 : -1
  const leftMetric = metric(left)
  const rightMetric = metric(right)
  const values: Record<SortKey, [number, number]> = {
    frontier: [left.isFrontier ? 1 : left.verified ? 0.5 : 0, right.isFrontier ? 1 : right.verified ? 0.5 : 0],
    operations: [left.operationsPerDay, right.operationsPerDay],
    sanity: [leftMetric?.productionSanityPerDay ?? -Infinity, rightMetric?.productionSanityPerDay ?? -Infinity],
    lmd: [leftMetric?.lmdPerDay ?? -Infinity, rightMetric?.lmdPerDay ?? -Infinity],
    battle: [leftMetric?.battleRecordPerDay ?? -Infinity, rightMetric?.battleRecordPerDay ?? -Infinity],
    goldNet: [leftMetric?.pureGoldNetPerDay ?? -Infinity, rightMetric?.pureGoldNetPerDay ?? -Infinity],
  }
  const [a, b] = values[sort.key]
  if (a !== b) return (a - b) * direction
  return left.operationsPerDay - right.operationsPerDay || (rightMetric?.productionSanityPerDay ?? 0) - (leftMetric?.productionSanityPerDay ?? 0) || left.id.localeCompare(right.id)
}

function scheduleLabel(point: ScenarioComparisonPoint): string {
  return point.scheduleMode === 'rotation' ? '游戏内轮换 12h×2' : `MAA ${point.shiftHours[0]}h×${point.shiftHours.length}`
}

function droneLabel(value: ScenarioComparisonPoint['droneStrategy']): string {
  return ({ off: '无人机关闭', auto: '无人机自动', lmd: '加速龙门币', pure_gold: '加速赤金', battle_record: '加速经验' })[value]
}

function number(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number(value)}`
}
