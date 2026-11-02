import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import { ExpandIcon, ManufactureIcon, TradingStationIcon } from '../../components/icons'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { formatAmount, type PreparedResult } from '../../components/result-panel/formatters'
import { PRODUCT_LABELS, ROOM_LABELS } from '../../components/result-panel/labels'
import { calculateProductionSanity } from '../../lib/production-sanity'
import { recyclingSanity } from '../../lib/recycling'
import { SANITY_PER_BATTLE_RECORD, SANITY_PER_LMD, SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY, SANITY_PER_ORUNDUM, SANITY_PER_PURE_GOLD } from '../../lib/orundum-economy'
import type { DailyProduction, OptimizeResult, OrundumEconomy } from '../../lib/types'
import './income-analysis.css'

const text = copy.v2
const amount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const values: Record<string, { value: number; formula: string }> = {
  LMD: { value: SANITY_PER_LMD, formula: '36 ÷ 10,000' },
  'Battle Record': { value: SANITY_PER_BATTLE_RECORD / 1000, formula: '36 ÷ 10,000' },
  'Pure Gold': { value: SANITY_PER_PURE_GOLD, formula: '36 ÷ 10,000 × 145 ÷ 229 × 50 ÷ 3 × 24' },
  Orundum: { value: SANITY_PER_ORUNDUM, formula: '3 ÷ 4' },
  'Originium Shard': { value: SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY, formula: '60 ÷ 72 × ' + SANITY_PER_PURE_GOLD.toFixed(6) },
}

const outputAmount = (product: string, value: number) => product === 'Battle Record' ? value * 1000 : value
const outputLabel = (product: string) => product === 'Battle Record' ? text.comparison.experience : PRODUCT_LABELS[product] ?? product

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

function ProductionAmount({ product, value }: { product: string; value: number }) {
  return <span className="v2-product-amount"><ProductIcon product={product} size={20} />{outputLabel(product)} {amount(outputAmount(product, value))}</span>
}

export function RoomProduction({ daily, room, shift }: { daily: DailyProduction; room: BoardRoom; shift?: string }) {
  const rows = stationProductionRows(daily).filter((row) => row.roomType === room.roomType && row.roomIndex === room.roomIndex + 1 && row.shift === shift)
  if (!rows.length) return null
  return <div className="v2-room-production"><dt>{text.estimatedAmount}</dt><dd>{rows.map((row, index) => <div key={index}>
    {row.drones && <span className="v2-neutral-tag">{text.drones}</span>}<ProductionAmount product={row.product} value={row.amount} />
  </div>)}</dd></div>
}

export default function IncomeAnalysis({ result, prepared }: { result: OptimizeResult; prepared: PreparedResult }) {
  const daily = result.daily_production
  const rows = stationProductionRows(daily)
  const stations = [...new Set(rows.map((row) => `${row.roomType}-${row.roomIndex}`))].map((key) => {
    const stationRows = rows.filter((row) => `${row.roomType}-${row.roomIndex}` === key)
    const production: Record<string, number> = {}
    for (const row of stationRows) production[row.product] = (production[row.product] ?? 0) + row.amount
    return { key, rows: stationRows, production }
  })
  const sanity = calculateProductionSanity(daily)
  const products = Object.keys(values)
    .filter((key) => (daily?.manufacturing?.[key] ?? daily?.trading?.[key] ?? 0) !== 0 || (daily?.consumption?.[key] ?? 0) !== 0)
    .map((product) => {
      const rawProduced = (daily?.manufacturing?.[product] ?? 0) + (daily?.trading?.[product] ?? 0)
      const produced = outputAmount(product, rawProduced)
      const consumed = outputAmount(product, daily?.consumption?.[product] ?? 0)
      return { product, rawProduced, produced, consumed, unit: values[product], net: (produced - consumed) * values[product].value }
    })
  const recoveredSanity = recyclingSanity(daily?.recycling)
  const contributions = [
    ...products.map(({ product, produced, consumed, net }) => ({ product, label: outputLabel(product),
      note: `${text.dailyOutput} ${amount(produced)}${consumed > 0 ? ` · ${text.consumption} ${amount(consumed)}` : ''}`, value: net })),
    ...(recoveredSanity > 0 ? [{ product: null, label: copy.domain.recycling.title, note: text.outputValue, value: recoveredSanity }] : []),
  ]
  const maxContribution = Math.max(1, ...contributions.map(({ value }) => Math.abs(value)))

  return <div className="v2-income-content">
    {prepared.orundumEconomy && <OrundumProductionAnalysis economy={prepared.orundumEconomy} daily={daily} />}
    <section className="v2-income-section" aria-label={text.stationOutput}>
      <header className="v2-income-heading"><h3>{text.stationOutput}</h3><p>{text.stationOutputNote}</p></header>
      {stations.length ? <div className="v2-income-stations">{stations.map((station) => {
        const first = station.rows[0]
        const Icon = first.roomType === 'trading' ? TradingStationIcon : ManufactureIcon
        return <article className={`v2-income-station v2-income-station-${first.roomType}`} key={station.key}>
          <details><summary>
            <h4><Icon size={18} aria-hidden="true" />{ROOM_LABELS[first.roomType]} {first.roomIndex}<ExpandIcon className="v2-income-station-chevron" size={16} aria-hidden="true" /></h4>
            <div className="v2-income-station-total">{Object.entries(station.production).map(([product, value]) => <ProductionAmount key={product} product={product} value={value} />)}</div>
            <span className="v2-income-caption">{text.stationShiftDetails}</span>
          </summary><ul>{station.rows.map((row, index) => <li key={index}>
            <div className="v2-income-shift"><span>{row.shift}</span>{row.drones && <span className="v2-neutral-tag">{text.drones}</span>}{row.capacityLimited && <span className="v2-neutral-tag">{text.capacityLimited}</span>}</div>
            <ProductionAmount product={row.product} value={row.amount} />
            <dl className="v2-income-station-meta">
              {Object.keys(row.consume).length > 0 && <div><dt>{text.consumption}</dt><dd>{Object.entries(row.consume).map(([product, value]) => `${outputLabel(product)} ${amount(outputAmount(product, value))}`).join(' · ')}</dd></div>}
              <div><dt>{text.sanityContribution}</dt><dd>{row.sanity === null ? '—' : amount(row.sanity)}</dd></div>
            </dl>
          </li>)}</ul></details>
        </article>
      })}</div> : <p className="v2-analysis-note">{text.noStationOutput}</p>}
    </section>
    <section className="v2-income-section" aria-label={text.sanityCalculation}>
      <header className="v2-income-heading"><h3>{text.sanityCalculation}</h3><p>{text.sanityCalculationNote}</p></header>
      <div className="v2-income-sanity-total"><img src="/assets/products/AP_GAMEPLAY.png" alt="" width={36} height={36} /><strong>{daily ? sanity.value.toFixed(2) : '—'}</strong><span>{text.sanityUnit}</span></div>
      <p className="v2-income-caption">{sanity.note}</p>
      <ul className="v2-income-contributions">{contributions.map(({ product, label, note, value }) => <li key={label}>
        {product ? <ProductIcon product={product} size={32} /> : <img src="/assets/products/AP_GAMEPLAY.png" alt="" width={32} height={32} />}
        <div className="v2-income-contribution-label"><h4>{label}</h4><p>{note}</p></div>
        <strong className={value < 0 ? 'v2-income-negative' : ''}>{value > 0 ? '+' : ''}{amount(value)}<small>{text.sanityUnit}</small></strong>
        <div className="v2-income-contribution-track" aria-hidden="true"><span className={value < 0 ? 'v2-income-negative-bar' : ''} style={{ width: `${Math.abs(value) / maxContribution * 100}%` }} /></div>
      </li>)}</ul>
      <details className="v2-income-disclosure"><summary>{text.conversionDetails}</summary>
        <p className="v2-income-caption">{text.sanityFormula}</p>
        <dl className="v2-income-formulas">{products.map(({ product, rawProduced, produced, consumed, unit }) => <div key={product}>
          <dt>{outputLabel(product)}</dt><dd>
            <p>{text.conversion}：{unit.value.toFixed(6)}<span className="v2-income-caption">（{unit.formula}）</span></p>
            {product === 'Battle Record' && <p className="v2-income-caption">{text.battleRecordEquivalent(amount(rawProduced))}</p>}
            <p>{text.outputValue}：{amount(produced)} × {unit.value.toFixed(6)} ≈ {amount(produced * unit.value)}</p>
            {consumed > 0 && <p>{text.consumptionValue}：{amount(consumed)} × {unit.value.toFixed(6)} ≈ {amount(consumed * unit.value)}</p>}
          </dd>
        </div>)}</dl>
      </details>
    </section>
    <details className="v2-income-disclosure v2-feature-content">
      <summary>{text.efficiencyDetails}</summary>
      <h3>{text.totalEfficiency} · {formatAmount(prepared.totalEff)}%</h3>
      <p className="v2-income-caption">{text.efficiencyHint}</p>
      {prepared.rotationStatsNote && <p>{prepared.rotationStatsNote}</p>}
      {(result.raw_total_efficiency !== undefined || result.raw_results.length > 0) && Math.abs(prepared.totalEff - prepared.rawTotalEff) >= 0.05 && <p>{text.rawTotalEfficiency} · {formatAmount(prepared.rawTotalEff)}%</p>}
    </details>
  </div>
}

function OrundumProductionAnalysis({ economy, daily }: { economy: OrundumEconomy; daily?: DailyProduction }) {
  const limits = [
    { label: text.rockLimitedOrundum, value: economy.rock_limited_orundum },
    ...(economy.lmd_limited_orundum !== undefined ? [{ label: text.lmdLimitedOrundum, value: economy.lmd_limited_orundum }] : []),
    { label: text.factoryOrundumCapacity, value: economy.factory_orundum_capacity },
    { label: text.tradeOrundumCapacity, value: economy.trade_orundum_capacity },
  ]
  const minCapacity = Math.min(...limits.map(({ value }) => value))
  const maxCapacity = Math.max(1, ...limits.map(({ value }) => value))
  const resources = [
    { label: text.totalSanityBudget, product: null, rows: [
      [text.dailySanityBudget, economy.daily_sanity_budget, text.sanityUnit],
      [text.monthlyCardSanity, economy.total_daily_sanity_budget - economy.daily_sanity_budget, text.sanityUnit],
      [text.totalSanityBudget, economy.total_daily_sanity_budget, text.sanityUnit],
    ] },
    { label: text.dailyOrirockSupply, product: 'Orirock Cube', rows: [
      [text.dailyOrirockSupply, economy.daily_orirock_supply, text.orirockUnit],
      ...(economy.daily_orirock_cost !== undefined ? [[text.orirockCost, economy.daily_orirock_cost, text.orirockUnit] as const] : []),
    ] },
    { label: text.dailyShardProduction, product: 'Originium Shard', rows: [
      [text.dailyShardProduction, daily?.manufacturing?.['Originium Shard'] ?? 0, text.orirockUnit],
      [text.dailyShardConsumption, daily?.consumption?.['Originium Shard'] ?? 0, text.orirockUnit],
    ] },
    { label: text.lmdNetChange, product: 'LMD', rows: [
      ...(economy.daily_lmd_income !== undefined ? [[text.dailyLmdIncome, economy.daily_lmd_income, text.daily] as const] : []),
      [text.shardLmdCost, economy.hard_lmd_cost, text.daily],
      ...(economy.daily_lmd_net !== undefined ? [[text.lmdNetChange, economy.daily_lmd_net, text.daily] as const] : []),
    ] },
  ] as const
  const inventory = [
    { label: text.shardInventoryDepletion, product: 'Originium Shard', days: economy.shard_inventory_depletion_days },
    { label: text.orirockInventoryDepletion, product: 'Orirock Cube', days: economy.orirock_inventory_depletion_days },
    { label: text.lmdInventoryDepletion, product: 'LMD', days: economy.lmd_inventory_depletion_days },
  ].flatMap((item) => item.days == null ? [] : [{ ...item, days: item.days }])

  return <section className="v2-income-section v2-income-orundum" aria-label={text.orundumInputs}>
    <header className="v2-income-heading"><h3>{text.orundumCapacity}</h3><p>{text.orundumCapacitySummary}</p></header>
    <dl className="v2-income-lead">
      <div className="v2-income-primary"><dt><ProductIcon product="Orundum" size={28} />{text.sustainableOrundum}</dt><dd><strong>{amount(economy.sustainable_orundum)}</strong><span>{text.orundumUnit}</span></dd></div>
      <div><dt>{text.shortTermOrundum}</dt><dd><strong>{amount(economy.short_term_orundum)}</strong><span>{text.orundumUnit}</span></dd></div>
      <div><dt>{text.inventoryDepletion}</dt><dd>{economy.inventory_depletion_days !== null ? <><strong>{amount(economy.inventory_depletion_days)}</strong><span>{text.daysUnit}</span></> : <span>{economy.case === 'inventory_burst' ? text.orundumDurationUnavailable : text.orundumOutputSustainable}</span>}</dd></div>
    </dl>
    <div className="v2-income-capacity">
      <h4>{text.capacityLimits}</h4>
      <ul>{limits.map(({ label, value }) => <li key={label} data-limited={value === minCapacity}>
        <div className="v2-income-capacity-label"><span>{label}</span>{value === minCapacity && <span className="v2-neutral-tag">{text.capacityBottleneck}</span>}<strong>{amount(value)}<small>{text.orundumUnit}</small></strong></div>
        <div className="v2-income-capacity-track" aria-hidden="true"><span style={{ width: `${Math.max(0, value) / maxCapacity * 100}%` }} /></div>
      </li>)}</ul>
    </div>
    <div className="v2-income-resources"><h4>{text.dailyResourceFlow}</h4><div>{resources.map(({ label, product, rows: resourceRows }) => <dl key={label}>
      <div className="v2-income-resource-icon" aria-hidden="true">{product ? <ProductIcon product={product} size={32} /> : <img src="/assets/products/AP_GAMEPLAY.png" alt="" width={32} height={32} />}</div>
      {resourceRows.map(([rowLabel, value, unit]) => <div key={rowLabel}><dt>{rowLabel}</dt><dd className={value < 0 ? 'v2-income-negative' : ''}>{amount(value)} <small>{unit}</small></dd></div>)}
    </dl>)}</div></div>
    {inventory.length > 0 && <div className="v2-income-inventory"><h4>{text.inventorySupport}</h4><dl>{inventory.map(({ label, product, days }) => <div key={label}>
      <dt><ProductIcon product={product} size={24} />{label}</dt><dd>{amount(days)} <small>{text.daysUnit}</small></dd>
    </div>)}</dl></div>}
    <details className="v2-income-disclosure"><summary>{text.calculationDetails}</summary>
      <p className="v2-income-caption">{text.orundumCapacityNote}</p>
      <p>{amount(economy.total_daily_sanity_budget)} ÷ 4.8 ≈ {amount(economy.daily_orirock_supply)} {text.orirockUnit}</p>
      <p>{text.sustainableOrundum} = min({limits.map(({ value }) => amount(value)).join(', ')}) ≈ {amount(economy.sustainable_orundum)} {text.orundumUnit}</p>
    </details>
  </section>
}
