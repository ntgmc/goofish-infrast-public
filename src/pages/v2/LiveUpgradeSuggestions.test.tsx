// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { cleanup, render, screen, waitFor, within } from '../../test/query-render'
import { copy } from '../../copy'
import type { OptimizeResult, UpgradeTrainingCost } from '../../lib/types'
import type { V2Session } from './OptionsDrawer'
import LiveUpgradeSuggestions from './LiveUpgradeSuggestions'

const mocks = vi.hoisted(() => ({ api: vi.fn(), snapshot: vi.fn(), refresh: vi.fn(), advisor: vi.fn((_props: unknown) => null) }))
vi.mock('../../lib/api-client', () => ({ apiJson: mocks.api }))
vi.mock('../../hooks/useSklandSnapshot', () => ({ useSklandSnapshot: mocks.snapshot }))
vi.mock('../../components/SklandDataActions', () => ({ default: ({ onRefresh }: { onRefresh: () => void }) => <button onClick={onRefresh}>{copy.skland.refresh}</button> }))
vi.mock('../../components/CultivationProjectImport', () => ({ default: () => null }))
vi.mock('./CultivationAdvisor', () => ({ default: mocks.advisor }))

const suggestion = { suggestion_id: 'upgrade-one', type: 'single' as const, id: 'char_test', name: '测试干员',
  current: 0, target: 1, gain: 1,
  roi: { efficiency_gain: 1, daily_sanity_gain: 10, payback_days: null, payback_basis: 'missing_sanity' as const } }
const session = { user: { id: 'user-1' }, activeProfile: { id: 'profile-1' } } as V2Session

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refresh.mockResolvedValue(undefined)
  snapshot('v1')
  mocks.api.mockResolvedValue(response(100))
})

afterEach(cleanup)

it('recovers missing stored costs and updates stock and payback when the shared snapshot changes', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  expect(await screen.findByText('仍有缺口')).toBeInTheDocument()
  expect(screen.getByText('约 10 天')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看解释' }))
  expect(screen.getByText('已有库存')).toBeInTheDocument()
  mocks.api.mockResolvedValue(response(0))
  snapshot('v2')
  rerender(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  expect(await within(screen.getByRole('article')).findByText('材料已够', { selector: 'span' })).toBeInTheDocument()
  expect(screen.getByText('0 天')).toBeInTheDocument()
  expect(mocks.advisor.mock.lastCall?.[0]).toMatchObject({ rows: [{ facts: expect.arrayContaining([copy.v2.workspaceAssistant.readyMaterials]) }] })
  expect(screen.getByRole('button', { name: '收起解释' })).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledTimes(2)
  expect(mocks.api).toHaveBeenCalledWith('/api/user/results/result-1?profile_id=profile-1&training_costs=latest', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('marks an old suggestion completed after refreshing progress and removes it from advisor candidates', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  expect(await screen.findByText('仍有缺口')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看解释' }))
  const latest = response(0)
  latest.item.result.upgrade_suggestions![0].training_cost!.operators = [{
    status: 'complete', id: suggestion.id, name: suggestion.name, current_elite: 1, target_elite: 1,
    current_level: 20, target_level: 20, totals: cost(0).totals, missing: cost(0).missing, warnings: [],
  }]
  mocks.api.mockResolvedValue(latest)
  snapshot('completed-v2')
  rerender(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  expect(await screen.findByText('已完成')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '收起解释' })).toBeInTheDocument()
  expect(screen.queryByText('预计回本')).not.toBeInTheDocument()
  expect(mocks.advisor.mock.lastCall?.[0]).toMatchObject({ rows: [] })
})

it('retries failed costs after refreshing even if the snapshot version is unchanged', async () => {
  const user = userEvent.setup()
  mocks.api.mockRejectedValueOnce(new Error('库存读取失败'))
  render(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('库存读取失败')
  await user.click(screen.getByRole('button', { name: copy.skland.refresh }))
  expect(await screen.findByText('仍有缺口')).toBeInTheDocument()
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.api).toHaveBeenCalledTimes(2)
})

it('cancels old reads on profile changes and cannot show their late costs', async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  mocks.api.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const { rerender } = render(<LiveUpgradeSuggestions suggestions={[suggestion]} session={session} resultId="result-1" />)
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce())
  const signal = mocks.api.mock.calls[0][1].signal as AbortSignal
  const other = { ...session, activeProfile: { id: 'profile-2' } } as V2Session
  rerender(<LiveUpgradeSuggestions suggestions={[suggestion]} session={other} resultId="result-2" />)
  expect(await screen.findByText('仍有缺口')).toBeInTheDocument()
  expect(signal.aborted).toBe(true)
  finish(response(0))
  await waitFor(() => expect(within(screen.getByRole('article')).queryByText('材料已够')).not.toBeInTheDocument())
})

it('does not use stored inventory when authorization or fresh inventory is unavailable', () => {
  mocks.snapshot.mockReturnValue({ data: null, busy: false, error: copy.skland.authorizationExpired, refresh: mocks.refresh })
  render(<LiveUpgradeSuggestions suggestions={[{ ...suggestion, training_cost: cost(0) }]} session={session} resultId="result-1" />)
  expect(screen.getByRole('alert')).toHaveTextContent(copy.skland.authorizationExpired)
  expect(screen.getByText('无法读取库存')).toBeInTheDocument()
  expect(within(screen.getByRole('article')).queryByText('材料已够')).not.toBeInTheDocument()
  expect(mocks.api).not.toHaveBeenCalled()
})

function snapshot(version: string) {
  mocks.snapshot.mockReturnValue({ data: { version, inventory: { items: { '4001': 100 }, fetchedAt: new Date().toISOString() } },
    busy: false, error: '', refresh: mocks.refresh })
}
function response(missing: number) {
  return { item: { result: { upgrade_suggestions: [{ ...suggestion, training_cost: cost(missing) }] } as OptimizeResult } }
}
function cost(missing: number): UpgradeTrainingCost {
  const bucket = (sanity: number) => ({ cash: sanity, exp: 0, materials: [], equivalent_sanity: sanity })
  return { status: 'available', totals: bucket(100), available: bucket(100 - missing), missing: bucket(missing),
    equivalent_sanity: 100, unpriced_items: [], warnings: [], operators: [],
    sources: { skland: 'ok', yituliu: 'fresh', pricing_snapshot_id: null, pricing_fetched_at: null, pricing_age_ms: null,
      valuation_version: null, lmd_exp: 'fixed_lmd_trade_gold_net_exp_36_per_10000' } }
}
