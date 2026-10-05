import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import ResultMetrics from '../../components/result-panel/ResultMetrics'
import type { PreparedResult } from '../../components/result-panel/formatters'
import { PRODUCT_LABELS, ROOM_LABELS } from '../../components/result-panel/labels'
import { calculateProductionSanity } from '../../lib/production-sanity'
import { SANITY_PER_BATTLE_RECORD, SANITY_PER_LMD, SANITY_PER_ORIGINIUM_SHARD, SANITY_PER_ORUNDUM, SANITY_PER_PURE_GOLD } from '../../lib/orundum-economy'
import type { DailyProduction, OptimizeResult, OrundumEconomy } from '../../lib/types'

const text = copy.v2
const amount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const values: Record<string, { value: number; formula: string }> = {
  LMD: { value: SANITY_PER_LMD, formula: '36 ÷ 10,000' },
  'Battle Record': { value: SANITY_PER_BATTLE_RECORD, formula: '36 ÷ 10,000 × 1,000' },
  'Pure Gold': { value: SANITY_PER_PURE_GOLD, formula: '36 ÷ 10,000 × 145 ÷ 229 × 50 ÷ 3 × 24' },
  Orundum: { value: SANITY_PER_ORUNDUM, formula: '3 ÷ 4' },
  'Originium Shard': { value: SANITY_PER_ORIGINIUM_SHARD, formula: '2 × 4.8 + 1,600 × 0.0036 + 60 ÷ 72 × ' + SANITY_PER_PURE_GOLD.toFixed(6) },
}

function numericMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

function stationProductionRows(daily: DailyProduction | undefined) {
  return (daily?.details ?? []).flatMap((detail) => {
    if (!['trading', 'manufacture'].includes(String(detail.room_type)) || typeof detail.room_index !== 'number'
      || !Number.isInteger(detail.room_index) || detail.room_index < 1 || typeof detail.product !== 'string'
      || typeof detail.amount !== 'number' || !Number.isFinite(detail.amount)) return []
    const consume = numericMap(detail.consume)
    const output = { [detail.product]: detail.amount }
    return [{
      roomType: String(detail.room_type), roomIndex: detail.room_index, product: detail.product,
      shift: typeof detail.shift === 'string' ? detail.shift : '—', amount: detail.amount,
      drones: detail.source === 'drones', capacityLimited: detail.capacity_limited === true, consume,
      sanity: values[detail.product] && Object.keys(consume).every((key) => values[key])
        ? calculateProductionSanity({ [detail.room_type === 'trading' ? 'trading' : 'manufacturing']: output, consumption: consume }).value : null,
    }]
  })
}

export default function IncomeAnalysis({ result, prepared }: { result: OptimizeResult; prepared: PreparedResult }) {
  const daily = result.daily_production
  const rows = stationProductionRows(daily)
  const sanity = calculateProductionSanity(daily)
  const products = Object.keys(values).filter((key) => (daily?.manufacturing?.[key] ?? daily?.trading?.[key] ?? 0) !== 0 || (daily?.consumption?.[key] ?? 0) !== 0)
  return <div className="v2-income-content">
    <h3>{text.stationOutput}</h3><p className="v2-muted">{text.stationOutputNote}</p>
    {rows.length ? <div className="v2-table-scroll" tabIndex={0} role="region" aria-label={text.stationOutput}>
      <table className="v2-income-table"><thead><tr><th>{text.room}</th><th>{text.shiftLabel}</th><th>{text.estimatedAmount}</th><th>{text.consumption}</th><th>{text.sanityContribution}</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>
          <th scope="row">{ROOM_LABELS[row.roomType]} {row.roomIndex}</th>
          <td>{row.shift}{row.drones && <span className="v2-neutral-tag">{text.drones}</span>}{row.capacityLimited && <small>{text.capacityLimited}</small>}</td>
          <td><span className="v2-product-amount"><ProductIcon product={row.product} size={20} />{PRODUCT_LABELS[row.product] ?? row.product} {amount(row.amount)}</span></td>
          <td>{Object.entries(row.consume).map(([product, value]) => `${PRODUCT_LABELS[product] ?? product} ${amount(value)}`).join(' · ') || '—'}</td>
          <td>{row.sanity === null ? '—' : amount(row.sanity)}</td>
        </tr>)}</tbody></table>
    </div> : <p className="v2-analysis-note">{text.noStationOutput}</p>}
    {result.orundum_economy && <OpportunityCostAnalysis economy={result.orundum_economy} />}
    <section className="v2-sanity-calculation" aria-label={text.sanityCalculation}>
      <h3>{text.sanityCalculation} · {sanity.value.toFixed(2)} {text.daily}</h3>
      <p>{text.sanityFormula}</p><p className="v2-muted">{sanity.note}</p>
      <div className="v2-table-scroll" tabIndex={0} role="region" aria-label={text.conversion}>
        <table className="v2-income-table"><thead><tr><th>{text.product}</th><th>{text.conversion}</th><th>{text.outputValue}</th><th>{text.consumptionValue}</th></tr></thead>
          <tbody>{products.map((product) => {
            const unit = values[product]
            const produced = (daily?.manufacturing?.[product] ?? 0) + (daily?.trading?.[product] ?? 0)
            const consumed = daily?.consumption?.[product] ?? 0
            return <tr key={product}><th scope="row">{PRODUCT_LABELS[product]}</th>
              <td>{unit.value.toFixed(6)}<small>{unit.formula}</small></td>
              <td>{amount(produced)} × {unit.value.toFixed(6)} ≈ {amount(produced * unit.value)}</td>
              <td>{consumed ? `${amount(consumed)} × ${unit.value.toFixed(6)} ≈ ${amount(consumed * unit.value)}` : '—'}</td></tr>
          })}</tbody></table>
      </div><p className="v2-muted">{text.sanityCalculationNote}</p>
    </section>
    <details className="v2-analysis-details v2-feature-content">
      <summary>{text.productionDetails}</summary>
      <ResultMetrics prepared={prepared} isRotationMode={result.schedule_mode === 'rotation'} />
    </details>
  </div>
}

function OpportunityCostAnalysis({ economy }: { economy: OrundumEconomy }) {
  const shards = economy.sustainable_orundum / 10
  const orirockCost = shards * 2 * 4.8
  const lmdCost = economy.hard_lmd_cost * SANITY_PER_LMD
  const factoryCost = shards * (60 / 72) * SANITY_PER_PURE_GOLD
  const shardCost = shards * SANITY_PER_ORIGINIUM_SHARD
  const orundumValue = economy.sustainable_orundum * SANITY_PER_ORUNDUM
  const capacityRows = [
    [text.dailySanityBudget, economy.daily_sanity_budget, text.opportunityCostUnit],
    [text.monthlyCardSanity, economy.total_daily_sanity_budget - economy.daily_sanity_budget, text.opportunityCostUnit],
    [text.totalSanityBudget, economy.total_daily_sanity_budget, text.opportunityCostUnit],
    [text.dailyOrirockSupply, economy.daily_orirock_supply, text.orirockUnit],
    [text.rockLimitedOrundum, economy.rock_limited_orundum, text.orundumUnit],
    [text.factoryOrundumCapacity, economy.factory_orundum_capacity, text.orundumUnit],
    [text.tradeOrundumCapacity, economy.trade_orundum_capacity, text.orundumUnit],
    [text.sustainableOrundum, economy.sustainable_orundum, text.orundumUnit],
    [text.shortTermOrundum, economy.short_term_orundum, text.orundumUnit],
    ...(economy.inventory_depletion_days !== null ? [[text.inventoryDepletion, economy.inventory_depletion_days, text.daysUnit] as const] : []),
  ] as const
  const costRows = [
    [text.orirockCost, `${amount(shards)} × 2 × 4.8`, orirockCost],
    [text.shardLmdCost, `(${amount(shards)} × 1,600 ≈ ${amount(economy.hard_lmd_cost)}) × ${SANITY_PER_LMD}`, lmdCost],
    [text.factoryOpportunityCost, `${amount(shards)} × 60 ÷ 72 × ${SANITY_PER_PURE_GOLD.toFixed(6)}`, factoryCost],
    [text.shardTotalCost, `${amount(shards)} × ${SANITY_PER_ORIGINIUM_SHARD.toFixed(6)}`, shardCost],
    [text.orundumSanityValue, `${amount(economy.sustainable_orundum)} × ${SANITY_PER_ORUNDUM}`, orundumValue],
    [text.opportunityCost, `max(0, ${amount(shardCost)} − ${amount(orundumValue)})`, economy.opportunity_cost_sanity],
  ] as const

  return <section className="v2-sanity-calculation" aria-label={text.opportunityCostCalculation}>
    <h3>{text.opportunityCostCalculation} · {economy.opportunity_cost_sanity.toFixed(2)} {text.opportunityCostUnit}</h3>
    <p>{text.opportunityCostFormula}</p><p className="v2-muted">{text.opportunityCostNote}</p>
    <h4>{text.orundumCapacity}</h4><p className="v2-muted">{text.orundumCapacityNote}</p>
    <div className="v2-table-scroll" tabIndex={0} role="region" aria-label={text.orundumCapacity}>
      <table className="v2-income-table"><thead><tr><th>{text.calculationItem}</th><th>{text.calculationBasis}</th></tr></thead>
        <tbody>{capacityRows.map(([label, value, unit]) => <tr key={label}>
          <th scope="row">{label}</th><td>{amount(value)} {unit}</td>
        </tr>)}</tbody></table>
    </div>
    <p>{amount(economy.total_daily_sanity_budget)} ÷ 4.8 ≈ {amount(economy.daily_orirock_supply)} {text.orirockUnit}</p>
    <p>{text.sustainableOrundum} = min({amount(economy.rock_limited_orundum)}, {amount(economy.factory_orundum_capacity)}, {amount(economy.trade_orundum_capacity)}) ≈ {amount(economy.sustainable_orundum)} {text.orundumUnit}</p>
    <h4>{text.opportunityCostDetails}</h4>
    <p>{text.dailyShardConsumption} = {amount(economy.sustainable_orundum)} ÷ 10 ≈ {amount(shards)} {PRODUCT_LABELS['Originium Shard']} {text.daily}</p>
    <div className="v2-table-scroll" tabIndex={0} role="region" aria-label={text.opportunityCostDetails}>
      <table className="v2-income-table"><thead><tr><th>{text.calculationItem}</th><th>{text.calculationBasis}</th><th>{text.sanityValue}</th></tr></thead>
        <tbody>{costRows.map(([label, formula, value]) => <tr key={label}>
          <th scope="row">{label}</th><td>{formula}</td><td>≈ {amount(value)}</td>
        </tr>)}</tbody></table>
    </div>
    <p className="v2-muted">{text.factoryOpportunityCostNote}</p>
    <p>{text.opportunityLmdEquivalent}：{amount(economy.opportunity_cost_sanity)} ÷ {SANITY_PER_LMD} ≈ {amount(economy.opportunity_lmd_equivalent)} {PRODUCT_LABELS.LMD} {text.daily}</p>
    <p className="v2-muted">{text.opportunityLmdNote}</p>
  </section>
}
