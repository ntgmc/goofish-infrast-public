// @vitest-environment jsdom
import { cleanup, render, screen, within } from '../../test/query-render'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { apiJson } from '../../lib/api-client'
import { copy } from '../../copy'
import { prepareResult } from '../../components/result-panel/formatters'
import type { WorkspaceResultHistorySummary } from '../../lib/types'
import { CONFIG_PRESETS } from '../../lib/config'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import ProductionSummary from './ProductionSummary'

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
