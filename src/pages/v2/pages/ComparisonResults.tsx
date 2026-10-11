import { useState } from 'react'
import { copy, CURRENT_LOCALE } from '../../../copy'
import type { LicenseConfig } from '../../../lib/types'
import type { ScenarioComparisonPoint, ScenarioComparisonResult } from '../../../lib/scenario-comparison'
import ScenarioParetoChart from '../../tool/optimize/scenario-lab/ScenarioParetoChart'
import { Facts, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.v2.comparison
const legacy = copy.optimize
const productionColumns = [
  { key: 'lmdPerDay', label: text.lmd },
  { key: 'battleRecordPerDay', label: text.experience },
  { key: 'orundumPerDay', label: text.orundum },
  { key: 'pureGoldProducedPerDay', label: text.gold },
  { key: 'originiumShardProducedPerDay', label: text.shard },
] as const
const sanityColumns = [{ key: 'productionSanityPerDay', label: text.sanity }] as const
type MetricKey = (typeof productionColumns)[number]['key'] | 'productionSanityPerDay' | 'operationsPerDay'

export default function ComparisonResults({ result, disabled, onApply }: {
  result: ScenarioComparisonResult
  disabled: boolean
  onApply: (config: LicenseConfig) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [production, setProduction] = useState(false)
  const [sort, setSort] = useState<{ key: MetricKey; ascending: boolean } | null>(null)
  const available = result.points.filter((point) => point.status === 'succeeded' && (point.verified ?? point.screening))
  const selected = result.points.find((point) => point.id === selectedId)
    ?? available.find((point) => point.isFrontier) ?? available[0] ?? result.points[0]
  const baseline = available.find((point) => point.id === baselineId) ?? available[0]
  const columns = production ? productionColumns : sanityColumns
  const sorted = [...result.points].sort((a, b) => {
    const aValue = valueOf(a, sort?.key ?? 'productionSanityPerDay')
    const bValue = valueOf(b, sort?.key ?? 'productionSanityPerDay')
    if (aValue == null || bValue == null) return aValue == null ? (bValue == null ? 0 : 1) : -1
    if (sort) return (aValue - bValue) * (sort.ascending ? 1 : -1)
    return Number(b.isFrontier) - Number(a.isFrontier) || bValue - aValue
  })
  const changeSort = (key: MetricKey) => setSort((current) => ({
    key, ascending: current?.key === key ? !current.ascending : key === 'operationsPerDay',
  }))

  return <section className="v2-comparison-outcome">
    <SectionTitle title={text.results} description={text.resultsHelp} />
    <Facts items={[[text.count, result.scenarioCount], [text.verified, result.verifiedCount], [text.failed, result.failedCount]]} />
    <div className="v2-comparison-toolbar">
      <div className="v2-view-switch" role="group" aria-label={text.display}>
        <button type="button" aria-pressed={!production} onClick={() => { setProduction(false); setSort(null) }}>{text.sanity}</button>
        <button type="button" aria-pressed={production} onClick={() => { setProduction(true); setSort(null) }}>{text.production}</button>
      </div>
      {baseline && <label className="v2-field"><span>{text.baseline}</span>
        <select className="v2-input" aria-label={text.baseline} value={baseline.id} onChange={(event) => setBaselineId(event.target.value)}>
          {available.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}
        </select>
      </label>}
    </div>
    <p className="v2-muted">{text.daily}</p>
    <div className="v2-comparison-table" role="region" aria-label={text.results} tabIndex={0}>
      <table>
        <thead><tr><th scope="col">{text.scheme}</th>
          {[{ key: 'operationsPerDay' as const, label: text.operations }, ...columns].map((column) => <th scope="col" key={column.key} aria-sort={sort?.key === column.key ? sort.ascending ? 'ascending' : 'descending' : 'none'}>
            <button type="button" onClick={() => changeSort(column.key)}>{column.label}{sort?.key === column.key ? sort.ascending ? ' ↑' : ' ↓' : ''}</button>
          </th>)}
        </tr></thead>
        <tbody>{sorted.map((point) => <tr key={point.id} data-selected={point.id === selected?.id}>
          <th scope="row"><button type="button" aria-pressed={point.id === selected?.id} onClick={() => setSelectedId(point.id)}>
            <strong>{point.label}</strong>
            <small>{point.status === 'failed' ? text.failed : point.verified ? text.verified : text.estimated}{point.isFrontier ? ` · ${text.recommended}` : ''}{point.id === baseline?.id ? ` · ${text.baselineMark}` : ''}</small>
          </button></th>
          <td>{valueOf(point, 'operationsPerDay') ?? '—'}</td>
          {columns.map((column) => {
            const value = valueOf(point, column.key)
            const reference = baseline ? valueOf(baseline, column.key) : null
            return <td key={column.key}><strong>{format(value)}</strong>
              {value != null && reference != null && point.id !== baseline?.id && <small className="v2-comparison-delta">{signed(value - reference)}</small>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {selected && <Selected point={selected} production={production} disabled={disabled} onApply={() => onApply(selected.config)} />}
    {result.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
    <details className="v2-disclosure"><summary>{text.chart}</summary>
      <ScenarioParetoChart points={result.points} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
    </details>
  </section>
}

function Selected({ point, production, disabled, onApply }: { point: ScenarioComparisonPoint; production: boolean; disabled: boolean; onApply: () => void }) {
  const value = point.verified ?? point.screening
  const economy = value?.orundumEconomy
  return <aside className="v2-comparison-selected">
    <SectionTitle title={text.selected} action={<button type="button" className="v2-button v2-button-primary" disabled={disabled || point.status !== 'succeeded' || !value} onClick={onApply}>{text.apply}</button>} />
    <h3>{point.label}</h3>
    <p className="v2-muted">{text.applyHelp}</p>
    <Facts items={[[text.shifts, point.shiftHours.join(' / ')], [text.operations, valueOf(point, 'operationsPerDay') ?? '—'], ...(!production ? [[text.sanityDaily, format(valueOf(point, 'productionSanityPerDay'))] as [string, string]] : [])]} />
    {(point.error || point.status === 'failed') && <Notice error>{point.error ?? text.failed}</Notice>}
    {production && value && point.status === 'succeeded' && <>
      <Facts items={productionColumns.map((column) => [column.label, format(valueOf(point, column.key))])} />
      <h3>{text.balance}</h3>
      <div className="v2-comparison-table"><table>
        <thead><tr><th scope="col">{text.resource}</th><th scope="col">{text.produced}</th><th scope="col">{text.consumed}</th><th scope="col">{text.net}</th></tr></thead>
        <tbody>{([
          [text.gold, value.pureGoldProducedPerDay, value.pureGoldConsumedPerDay, value.pureGoldNetPerDay],
          [text.shard, value.originiumShardProducedPerDay, value.originiumShardConsumedPerDay, value.originiumShardNetPerDay],
        ] as const).map(([label, produced, consumed, net]) => <tr key={label}><th scope="row">{label}</th><td>{format(produced)}</td><td>{format(consumed)}</td><td>{signed(net)}</td></tr>)}</tbody>
      </table></div>
      <Facts items={[[text.dronesGenerated, format(value.dronesGeneratedPerDay)], [text.dronesUsed, format(value.dronesUsedPerDay)], [text.dronesDiscarded, format(value.dronesDiscardedPerDay)]]} />
    </>}
    {value && point.scheduleStrategy === 'variable' && <p className="v2-muted">{point.variableShiftFallback ? legacy.pages_tool_optimize_ScenarioLabSection_033 : legacy.pages_tool_optimize_ScenarioLabSection_034}</p>}
    {economy && <Facts items={[
      [legacy.pages_tool_optimize_ScenarioLabSection_035, `${format(economy.sustainablePerDay)} / ${format(economy.shortTermPerDay)}`],
      [legacy.pages_tool_optimize_ScenarioLabSection_036, `${format(economy.opportunityCostSanityPerDay)}${legacy.pages_tool_optimize_ScenarioLabSection_037}`],
      [legacy.pages_tool_optimize_ScenarioLabSection_038, economy.inventoryDepletionDays == null ? '—' : `${format(economy.inventoryDepletionDays)}${legacy.pages_tool_optimize_ScenarioLabSection_039}`],
      [legacy.pages_tool_optimize_ScenarioLabSection_040, `${({ capacity_limited: legacy.pages_tool_optimize_ScenarioLabSection_044, budget_limited: legacy.pages_tool_optimize_ScenarioLabSection_045, inventory_burst: legacy.pages_tool_optimize_ScenarioLabSection_046 })[economy.case]} · ${({ orirock_budget: legacy.pages_tool_optimize_ScenarioLabSection_047, manufacture: legacy.pages_tool_optimize_ScenarioLabSection_048, trading: legacy.pages_tool_optimize_ScenarioLabSection_049, inventory: legacy.pages_tool_optimize_ScenarioLabSection_050 })[economy.bottleneck]}${legacy.pages_tool_optimize_ScenarioLabSection_041}${format(economy.dailySanityBudget)}${economy.monthlyCard ? legacy.pages_tool_optimize_ScenarioLabSection_042 : ''}`],
    ]} />}
  </aside>
}

function valueOf(point: ScenarioComparisonPoint, key: MetricKey): number | null {
  if (point.status !== 'succeeded') return null
  const value = key === 'operationsPerDay' ? point.operationsPerDay : (point.verified ?? point.screening)?.[key]
  if (value == null || !Number.isFinite(value)) return null
  return key === 'battleRecordPerDay' ? value * 1000 : value
}

function format(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1 })
}

function signed(value: number): string {
  return value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
}
