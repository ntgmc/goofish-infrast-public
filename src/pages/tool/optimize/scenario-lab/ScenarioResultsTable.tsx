import { useMemo, useState } from 'react'
import { formatShiftHours, type ScenarioComparisonPoint, type ScenarioMetrics } from '../../../../lib/scenario-comparison'
import { copy, CURRENT_LOCALE } from '../../../../copy/index'


type SortKey = 'frontier' | 'operations' | 'sanity' | 'lmd' | 'battle' | 'orundum' | 'opportunity'

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
  const baseline = points.find((point) => metric(point))
  const baselineMetric = baseline ? metric(baseline) : undefined
  const changeSort = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key
      ? current.direction === 'descending' ? 'ascending' : 'descending'
      : key === 'opportunity' ? 'ascending' : 'descending',
  }))

  return (
    <div>
      <div className="tool-inset hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-[1320px] border-collapse text-left text-xs">
          <thead className="bg-surface-2 text-ink-secondary">
            <tr>
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_001} sticky />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_002} sortKey="operations" sort={sort} onSort={changeSort} />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_003} sortKey="sanity" sort={sort} onSort={changeSort} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_048} />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_004} sortKey="lmd" sort={sort} onSort={changeSort} />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_005} sortKey="battle" sort={sort} onSort={changeSort} />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_006} sortKey="orundum" sort={sort} onSort={changeSort} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_007} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_008} />
              <SortableHeader label={`${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_009}（${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_047}）`} sortKey="opportunity" sort={sort} onSort={changeSort} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_010} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_011} />
              <Header label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_049} />
              <SortableHeader label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_012} sortKey="frontier" sort={sort} onSort={changeSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3/70">
            {sorted.map((point) => {
              const value = metric(point)
              const selected = point.id === selectedId
              return (
                <tr key={point.id} className={selected ? 'bg-brand-600/10' : 'bg-surface-1 hover:bg-surface-2/70'}>
                  <td className={`sticky left-0 z-10 p-0 ${selected ? 'bg-surface-2' : 'bg-surface-1'}`}>
                    <button type="button" onClick={() => onSelect(point.id)} aria-pressed={selected} className="min-h-11 w-72 px-3 py-2 text-left font-medium text-ink-primary focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45">
                      <span className="block">{productionPlanLabel(point)}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-ink-muted">{scheduleLabel(point)} · {droneLabel(point.droneStrategy)}</span>
                    </button>
                  </td>
                  <Cell value={point.operationsPerDay > 0 ? `${point.operationsPerDay}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_013}` : '—'} />
                  <Cell value={value ? number(value.productionSanityPerDay) : '—'} strong />
                  <Cell value={value && baselineMetric ? signedDelta(value.productionSanityPerDay - baselineMetric.productionSanityPerDay) : '—'} />
                  <Cell value={value ? number(value.lmdPerDay) : '—'} />
                  <Cell value={value ? number(value.battleRecordPerDay) : '—'} />
                  <Cell value={value?.orundumEconomy ? `${number(value.orundumEconomy.sustainablePerDay)} / ${number(value.orundumEconomy.shortTermPerDay)}` : '—'} />
                  <Cell value={value ? resourceTriple(value.pureGoldProducedPerDay, value.pureGoldConsumedPerDay, value.pureGoldNetPerDay) : '—'} />
                  <Cell value={value ? resourceTriple(value.originiumShardProducedPerDay, value.originiumShardConsumedPerDay, value.originiumShardNetPerDay) : '—'} />
                  <Cell value={value?.orundumEconomy ? `${number(value.orundumEconomy.opportunityCostSanityPerDay)} / ${number(value.orundumEconomy.hardLmdCostPerDay)}` : '—'} />
                  <Cell value={value?.orundumEconomy?.inventoryDepletionDays == null ? '—' : `${number(value.orundumEconomy.inventoryDepletionDays)}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_014}`} />
                  <Cell value={value ? `${number(value.dronesUsedPerDay)} / ${number(value.dronesDiscardedPerDay)}` : '—'} />
                  <Cell value={value ? applicability(point, value) : '—'} />
                  <td className="px-3 py-2"><Status point={point} /></td>
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
            <button key={point.id} type="button" onClick={() => onSelect(point.id)} aria-pressed={point.id === selectedId} className={`tool-inset min-h-11 p-4 text-left focus:outline-none focus:ring-2 focus:ring-brand-500/45 ${point.id === selectedId ? 'border-brand-500 bg-brand-600/10' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-primary">{productionPlanLabel(point)}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{scheduleLabel(point)} · {droneLabel(point.droneStrategy)}</p>
                </div>
                <Status point={point} />
              </div>
              {value ? (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_015} value={number(value.productionSanityPerDay)} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_016} value={`${point.operationsPerDay}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_017}`} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_018} value={number(value.lmdPerDay)} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_019} value={number(value.battleRecordPerDay)} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_020} value={value.orundumEconomy ? `${number(value.orundumEconomy.sustainablePerDay)} / ${number(value.orundumEconomy.shortTermPerDay)}` : '—'} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_021} value={resourceTriple(value.originiumShardProducedPerDay, value.originiumShardConsumedPerDay, value.originiumShardNetPerDay)} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_022} value={value.orundumEconomy ? number(value.orundumEconomy.opportunityCostSanityPerDay) : '—'} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_023} value={value.orundumEconomy?.inventoryDepletionDays == null ? '—' : `${number(value.orundumEconomy.inventoryDepletionDays)}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_024}`} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_025} value={signed(value.pureGoldNetPerDay)} />
                  <Stat label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_026} value={number(value.dronesUsedPerDay)} />
                </dl>
              ) : <p className="mt-3 text-xs text-error" role="alert">{point.error ?? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_027}</p>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Header({ label, sticky = false }: { label: string; sticky?: boolean }) {
  return <th scope="col" className={`px-3 py-2 font-semibold ${sticky ? 'sticky left-0 z-20 bg-surface-2' : ''}`}>{label}</th>
}

function SortableHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; direction: 'ascending' | 'descending' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th scope="col" className="p-0" aria-sort={active ? sort.direction : 'none'}>
      <button type="button" onClick={() => onSort(sortKey)} className="min-h-11 w-full whitespace-nowrap px-3 py-2 text-left font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45">
        {label}{active ? (sort.direction === 'descending' ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )
}

function Cell({ value, strong = false }: { value: string; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${strong ? 'font-semibold text-ink-primary' : 'text-ink-secondary'}`}>{value}</td>
}

function Status({ point }: { point: ScenarioComparisonPoint }) {
  const className = point.isFrontier ? 'tool-status--success' : point.verified ? 'tool-status--current' : point.status === 'failed' ? 'tool-status--error' : ''
  const label = point.isFrontier ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_028 : point.verified ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_029 : point.status === 'failed' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_030 : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_031
  return <span className={`tool-status whitespace-nowrap ${className}`}>{label}</span>
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="tool-inset px-2 py-2"><dt className="text-ink-muted">{label}</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink-primary">{value}</dd></div>
}

function metric(point: ScenarioComparisonPoint): ScenarioMetrics | undefined {
  return point.verified ?? point.screening
}

function compare(left: ScenarioComparisonPoint, right: ScenarioComparisonPoint, sort: { key: SortKey; direction: 'ascending' | 'descending' }): number {
  if (left.status === 'failed' && right.status !== 'failed') return 1
  if (right.status === 'failed' && left.status !== 'failed') return -1
  const direction = sort.direction === 'ascending' ? 1 : -1
  const leftMetric = metric(left)
  const rightMetric = metric(right)
  const values: Record<SortKey, [number | null, number | null]> = {
    frontier: [left.isFrontier ? 1 : left.verified ? 0.5 : 0, right.isFrontier ? 1 : right.verified ? 0.5 : 0],
    operations: [left.operationsPerDay, right.operationsPerDay],
    sanity: [leftMetric?.productionSanityPerDay ?? null, rightMetric?.productionSanityPerDay ?? null],
    lmd: [leftMetric?.lmdPerDay ?? null, rightMetric?.lmdPerDay ?? null],
    battle: [leftMetric?.battleRecordPerDay ?? null, rightMetric?.battleRecordPerDay ?? null],
    orundum: [leftMetric?.orundumEconomy?.sustainablePerDay ?? null, rightMetric?.orundumEconomy?.sustainablePerDay ?? null],
    opportunity: [leftMetric?.orundumEconomy?.opportunityCostSanityPerDay ?? null, rightMetric?.orundumEconomy?.opportunityCostSanityPerDay ?? null],
  }
  const [a, b] = values[sort.key]
  if (a === null && b !== null) return 1
  if (b === null && a !== null) return -1
  if (a !== null && b !== null && a !== b) return (a - b) * direction
  return left.operationsPerDay - right.operationsPerDay || (rightMetric?.productionSanityPerDay ?? 0) - (leftMetric?.productionSanityPerDay ?? 0) || left.id.localeCompare(right.id)
}

function productionPlanLabel(point: ScenarioComparisonPoint): string {
  const plan = point.productionPlan
  return `${point.layout}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_032}${plan.trading.lmd}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_033}${plan.trading.orundum}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_034}${plan.manufacturing.pureGold}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_035}${plan.manufacturing.battleRecord}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_036}${plan.manufacturing.originiumShard}`
}

function scheduleLabel(point: ScenarioComparisonPoint): string {
  if (point.scheduleMode === 'rotation') return copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_037
  const prefix = point.scheduleStrategy === 'variable' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_038 : 'MAA'
  const fallback = point.variableShiftFallback ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_039 : ''
  return `${prefix} ${formatShiftHours(point.shiftHours)}${fallback}`
}

function droneLabel(value: ScenarioComparisonPoint['droneStrategy']): string {
  return ({
    off: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_040,
    auto: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_041,
    lmd: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_042,
    orundum: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_043,
    pure_gold: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_044,
    battle_record: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_045,
    originium_shard: copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_046,
  })[value]
}

function resourceTriple(produced: number, consumed: number, net: number): string {
  return `${number(produced)} / ${number(consumed)} / ${signed(net)}`
}

function number(value: number): string {
  return value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1 })
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number(value)}`
}

function signedDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${number(value)}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_050}`
}

function applicability(point: ScenarioComparisonPoint, value: ScenarioMetrics): string {
  if (value.orundumEconomy) {
    const caseLabel = value.orundumEconomy.case === 'capacity_limited' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_051
      : value.orundumEconomy.case === 'budget_limited' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_052 : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_053
    const bottleneck = value.orundumEconomy.bottleneck === 'inventory' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_054
      : value.orundumEconomy.bottleneck === 'orirock_budget' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_055
        : value.orundumEconomy.bottleneck === 'manufacture' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_056 : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_057
    return `${caseLabel} · ${bottleneck}`
  }
  return point.scheduleMode === 'rotation' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_058 : `${point.scheduleStrategy === 'variable' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_059 : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_060} · ${point.droneStrategy === 'off' ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_061 : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioResultsTable_062}`
}
