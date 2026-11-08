// @vitest-environment jsdom
import { cleanup, render, screen, within } from '../../test/query-render'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { apiJson } from '../../lib/api-client'
import { copy } from '../../copy'
import { prepareResult } from '../../components/result-panel/formatters'
import type { OrundumEconomy, WorkspaceResultHistorySummary } from '../../lib/types'
import { CONFIG_PRESETS } from '../../lib/config'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import ProductionSummary from './ProductionSummary'
import IncomeAnalysis from './IncomeAnalysis'

vi.mock('../../lib/api-client', async (original) => ({
  ...await original<typeof import('../../lib/api-client')>(),
  apiJson: vi.fn(),
}))

const current: WorkspaceResultHistorySummary = {
  id: 'current-result', name: 'Current schedule', created_at: '2026-10-05T00:00:00Z',
  operator_count: SAMPLE_OPERATORS.length, source: 'generated', archived: false,
  schedule_mode: 'maa', maa_exportable: true, has_config: true,
}
const previous: WorkspaceResultHistorySummary = {
  id: 'previous-result', name: 'Orundum schedule', created_at: '2026-10-04T00:00:00Z',
  operator_count: SAMPLE_OPERATORS.length, source: 'generated', archived: false,
  schedule_mode: 'maa', maa_exportable: true, has_config: true,
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('uses optimizer cash flow and depletion instead of recalculating the production summary', async () => {
  const daily = { orundum_optimization: { preference: 'economy' as const, production_capacity: 900, baseline_sanity: 350, opportunity_cost_per_orundum: 1.8123 },
    manufacturing: { 'Originium Shard': 90 }, trading: { LMD: 41000, Orundum: 1000 }, consumption: { 'Originium Shard': 100, LMD: 160000 },
    details: [{ room_type: 'manufacture', room_index: 1, shift: '早班', product: 'Originium Shard', amount: 90, consume: { LMD: 160000 } }] }
  const economy: OrundumEconomy = {
    daily_sanity_budget: 240, monthly_card: false, total_daily_sanity_budget: 240,
    daily_orirock_supply: 50, rock_limited_orundum: 250, factory_orundum_capacity: 1000,
    trade_orundum_capacity: 1000, sustainable_orundum: 250, short_term_orundum: 1000,
    case: 'inventory_burst', bottleneck: 'inventory', hard_lmd_cost: 160000,
    daily_lmd_income: 40000, daily_lmd_net: -120000, daily_orirock_cost: 200,
    lmd_limited_orundum: 250, inventory_depletion_days: 2, shard_inventory_depletion_days: null,
    orirock_inventory_depletion_days: 10, lmd_inventory_depletion_days: 2,
    opportunity_cost_sanity: 0, opportunity_lmd_equivalent: 0,
  }
  const result = { ...SAMPLE_RESULT, daily_production: daily, orundum_economy: economy }
  const prepared = prepareResult(result, false, false)
  vi.mocked(apiJson).mockResolvedValue({ item: { ...previous, config: SAMPLE_CONFIG, result: {
    ...SAMPLE_RESULT, daily_production: { trading: { LMD: 50000, Orundum: 500 }, manufacturing: { 'Originium Shard': 50 } },
    orundum_economy: { ...economy, daily_lmd_net: -30000 },
  } } })
  render(<>
    <ProductionSummary userId="user-1" result={result} prepared={prepared} sample={false}
      profileId="profile-1" resultId={current.id} resultConfig={SAMPLE_CONFIG}
      history={[current, previous]} newResult={false} onConfigure={vi.fn()} />
    <IncomeAnalysis result={result} prepared={prepared} />
  </>)

  expect(screen.getByText(copy.v2.orundumPreferences.economy)).toBeInTheDocument()
  expect(screen.getByText(copy.v2.orundumUnitCost).closest('div')).toHaveTextContent('1.81')
  const cash = screen.getByRole('region', { name: copy.v2.lmdNetChange })
  expect(cash).toHaveTextContent('-120,000')
  expect(cash).toHaveTextContent('每日产出 40,000 · 制造碎片消耗 160,000')
  expect(screen.getByRole('region', { name: copy.v2.shortTermPulls })).toHaveTextContent('预计可持续 2 天')
  const inputsRegion = screen.getByRole('region', { name: copy.v2.orundumInputs })
  const inputs = within(inputsRegion)
  expect(inputs.getByText(copy.v2.shardLmdCost).closest('div')).toHaveTextContent('160,000')
  expect(inputs.getByText(copy.v2.lmdInventoryDepletion).closest('div')).toHaveTextContent('2 天')
  expect(inputs.getByText(copy.v2.orirockInventoryDepletion).closest('div')).toHaveTextContent('10 天')
  expect(inputsRegion.compareDocumentPosition(screen.getByRole('region', { name: copy.v2.stationOutput })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const calculation = within(screen.getByRole('region', { name: copy.v2.sanityCalculation }))
  expect(calculation.getByText('314.00')).toBeInTheDocument()
  expect(calculation.getByText('-428.4')).toBeInTheDocument()
  const station = within(screen.getByRole('region', { name: copy.v2.stationOutput }))
  await userEvent.click(station.getByText(copy.v2.stationShiftDetails))
  expect(station.getByText('-507.62')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.v2.comparePrevious }))
  const changes = within(await screen.findByRole('region', { name: copy.v2.productionChanges }))
  expect(changes.getByText(copy.v2.lmdNetChange).closest('div')).toHaveTextContent('-90,000')
})

it('uses the same empty-stock valuation for income details and schedule comparisons', async () => {
  const daily = { originium_shard_inventory: 0, manufacturing: { 'Originium Shard': 60 },
    trading: { Orundum: 1000 }, consumption: { 'Originium Shard': 100 },
    details: [{ room_type: 'trading', room_index: 1, shift: '早班', product: 'Orundum', amount: 1000,
      consume: { 'Originium Shard': 100 } }] }
  const result = { ...SAMPLE_RESULT, daily_production: daily, maa_default_comparison: {
    source: 'maa_default_simulation_v1' as const,
    simulation: { algorithm: 'maa_default_room_local_greedy_v1', facility_order: [], drones: 'Money', shift_hours: [8, 8, 8] },
    baseline: { daily_production: { originium_shard_inventory: 0, manufacturing: { 'Originium Shard': 40 },
      trading: { Orundum: 400 }, consumption: { 'Originium Shard': 40 } },
      total_efficiency: 0, raw_total_efficiency: 0, plan_count: 1, room_count: 1 },
    delta: { total_efficiency: 0, raw_total_efficiency: 0, manufacturing: { 'Originium Shard': 20 },
      trading: { Orundum: 600 }, consumption: { 'Originium Shard': 60 }, net: {}, drones: {} }, warnings: [],
  } }
  const prepared = prepareResult(result, false, false)
  expect(prepared.productionSanity.value).toBeCloseTo(450, 10)
  expect(prepared.maaDefaultComparison?.baselineSanity).toBeCloseTo(300, 10)
  expect(prepared.maaDefaultComparison?.sanityDelta).toBeCloseTo(150, 10)
  render(<IncomeAnalysis result={result} prepared={prepared} />)
  const calculation = within(screen.getByRole('region', { name: copy.v2.sanityCalculation }))
  expect(calculation.getByText('450.00')).toBeInTheDocument()
  expect(calculation.getByText('+450')).toBeInTheDocument()
  expect(calculation.getByText(`${copy.v2.dailyOutput} 600`)).toBeInTheDocument()
  const station = within(screen.getByRole('region', { name: copy.v2.stationOutput }))
  await userEvent.click(station.getByText(copy.v2.stationShiftDetails))
  expect(station.getByText('404.41')).toBeInTheDocument()
  expect(daily.trading.Orundum).toBe(1000)
})

it('keeps legacy income as gross income when the optimizer has not returned cash flow', () => {
  const result = { ...SAMPLE_RESULT, daily_production: { manufacturing: { 'Originium Shard': 10 }, trading: { LMD: 10000 } } }
  render(<ProductionSummary result={result} prepared={prepareResult(result, false, false)} sample
    history={[]} newResult={false} onConfigure={vi.fn()} />)
  expect(screen.getByRole('region', { name: copy.v2.lmd })).toHaveTextContent('10,000')
  expect(screen.queryByRole('region', { name: copy.v2.lmdNetChange })).not.toBeInTheDocument()
})

it.each([
  ['333', CONFIG_PRESETS['333'], SAMPLE_RESULT],
  ['243', CONFIG_PRESETS['243-1'], SAMPLE_RESULT],
  ['shard production', { ...SAMPLE_CONFIG, product_requirements: {
    trading_stations: { LMD: 2 }, manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 3 },
  } }, SAMPLE_RESULT],
  ['legacy Orundum output', null, { ...SAMPLE_RESULT, daily_production: { trading: { LMD: 51000, Orundum: 100 } } }],
  ['legacy shard output', null, { ...SAMPLE_RESULT, daily_production: { manufacturing: { 'Originium Shard': 20 } } }],
])('hides the sanity change in both views after a previous %s schedule', async (_name, config, result) => {
  vi.mocked(apiJson).mockResolvedValue({ item: { ...previous, config, result } })
  const user = userEvent.setup()
  const prepared = prepareResult(SAMPLE_RESULT, false, false, SAMPLE_OPERATORS)
  render(<ProductionSummary userId="user-1" result={SAMPLE_RESULT} prepared={prepared}
    sample={false} profileId="profile-1" resultId={current.id} resultConfig={SAMPLE_CONFIG}
    history={[current, previous]} newResult={false} onConfigure={vi.fn()} />)

  const sanity = screen.getByRole('region', { name: copy.v2.sanity })
  await user.click(screen.getByRole('button', { name: copy.v2.comparePrevious }))
  const comparison = within(await screen.findByRole('dialog', { name: copy.v2.resultComparison }))
  const changes = within(await comparison.findByRole('region', { name: copy.v2.productionChanges }))

  expect(changes.queryByText(copy.v2.sanity)).not.toBeInTheDocument()
  for (const label of [copy.v2.lmd, copy.v2.exp, copy.v2.goldNetChange]) {
    expect(changes.getByText(label)).toBeInTheDocument()
  }
  expect(sanity).toHaveTextContent(prepared.productionSanity.value.toFixed(2))
  expect(within(sanity).queryByText(copy.v2.sameAsPrevious)).not.toBeInTheDocument()
  expect(within(sanity).queryByText(copy.v2.changeFromPrevious, { exact: false })).not.toBeInTheDocument()
})
