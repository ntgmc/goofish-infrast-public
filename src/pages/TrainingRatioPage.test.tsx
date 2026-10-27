// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../copy'
import levels from '../data/training-level-data.json'
import type { SklandSnapshot } from '../lib/skland-snapshot'
import type { TrainingAccountData } from '../lib/training-ratio-account'
import type { WorkspaceResultHistoryItem } from '../lib/types'
import { syncSklandSnapshotSession } from '../lib/skland-snapshot-client'
import type { useToolSession } from './tool/useToolSession'
import TrainingRatioPage from './TrainingRatioPage'

const mocks = vi.hoisted(() => ({ api: vi.fn(), result: vi.fn(), stock: vi.fn(), catalog: vi.fn() }))
vi.mock('./tool/optimize/optimization-api', () => ({ fetchResultHistoryDetail: mocks.result }))
vi.mock('../lib/api-client', async (original) => ({ ...await original<typeof import('../lib/api-client')>(), apiJson: mocks.api }))
const text = copy.trainingRatio
function session(id = 'first', bound = true) {
  return { user: { id: 'user1' }, activeProfile: { id, display_name: id, status: 'active', skland_binding: bound ? { uid: id, credential_status: 'available' } : null }, profiles: [{ id, display_name: id, status: 'active' }] } as unknown as ReturnType<typeof useToolSession>
}
function withProduction(id = 'first', resultId = 'plan1') {
  return { ...session(id), workspace: { profile_id: id, latest_result: { id: resultId, name: resultId, source: 'generated' } } } as ReturnType<typeof useToolSession>
}
const production = (lmd: number, exp: number) => ({ result: { daily_production: { manufacturing: { 'Battle Record': exp / 1000 }, trading: { LMD: lmd } } } }) as unknown as WorkspaceResultHistoryItem
const view = (current = session()) => <MemoryRouter><TrainingRatioPage session={current} embedded /></MemoryRouter>
const data = { uid: 'first', version: '1', game: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null },
  inventory: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null, items: { '4001': 200000, '2004': 50 }, lmd: 200000, exp: 100000 }, retryAt: null } as SklandSnapshot
const account: TrainingAccountData = { snapshotVersion: '1', importedAt: '', inventory: { lmd: 200000, exp: 100000 }, levels, warnings: [], operators: [{
  id: 'a', name: '测试干员', rarity: 6, elite: 0, level: 1, modules: [{ id: 'x', name: '测试模组', elite: 2, level: 60, current: 0, costs: [80000, 100000, 120000], common: true }],
}] }
beforeEach(() => {
  syncSklandSnapshotSession({ user: { id: 'reset' }, profiles: [] } as never); syncSklandSnapshotSession(null)
  localStorage.clear(); sessionStorage.clear()
  mocks.stock.mockResolvedValue(data); mocks.catalog.mockResolvedValue(account)
  mocks.api.mockImplementation((path, options) => path === '/api/cultivation-plan' ? mocks.catalog(options) : mocks.stock(path, options))
  mocks.result.mockResolvedValue({ result: {} })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('calculates a dynamic account ratio without reading saved projects or persisting personal data', async () => {
  localStorage.setItem('maatool:cultivation-projects:user1:first', '[broken')
  render(view())
  expect(await screen.findByText(text.accountFocus.exp)).toBeInTheDocument()
  expect(screen.getByLabelText(text.accountReference)).toHaveTextContent('1.29∶1')
  expect(screen.getByText(text.noBaseIncome)).toBeInTheDocument()
  expect(mocks.catalog).toHaveBeenCalledWith(expect.objectContaining({ json: { profile_id: 'first', training: true }, signal: expect.any(AbortSignal) }))
  expect(screen.getByRole('spinbutton', { name: text.lmd, hidden: true })).not.toBeVisible()
  expect(localStorage.getItem('maatool:cultivation-projects:user1:first')).toBe('[broken')
  expect(sessionStorage.getItem('maatool:training-ratio:user1:first:goals')).not.toContain('测试干员')
  expect(sessionStorage.getItem('maatool:training-ratio:user1:first')).not.toContain('200000')
})

it('updates all costs locally when rarity and module goals change, including modules already partly upgraded', async () => {
  const user = userEvent.setup()
  render(view())
  await screen.findByText(text.accountFocus.exp)
  await user.click(within(screen.getByRole('group', { name: text.modules })).getByLabelText(text.moduleChoices.common))
  await user.click(screen.getByLabelText(text.moduleLevels[2]))
  expect(screen.getByLabelText(text.accountReference)).toHaveTextContent('1.8∶1')
  expect(screen.getByText(text.moduleCost).parentElement).toHaveTextContent('300,000')
  await user.click(screen.getByText(text.selectedModules(1)))
  expect(screen.getByText('测试干员 · 测试模组')).toBeVisible()
  await user.click(within(screen.getByRole('group', { name: /六星/ })).getByLabelText(text.goalChoices.none))
  expect(screen.getByText(text.accountFocus.ready)).toBeInTheDocument()
  expect(screen.getByLabelText(text.accountReference)).toHaveTextContent(text.noDemand)
  expect(mocks.catalog).toHaveBeenCalledTimes(1)
})

it('keeps manual calculations and account goals separate when switching tabs', async () => {
  const user = userEvent.setup()
  render(view())
  await screen.findByText(text.importedSource)
  await user.click(screen.getByRole('tab', { name: text.manual }))
  expect(screen.getByLabelText(text.reference)).toHaveTextContent(text.referenceValue)
  expect(screen.getByText(text.noManualInventory)).toBeInTheDocument()
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  await user.type(screen.getByRole('spinbutton', { name: text.lmd }), '100000')
  await user.clear(screen.getByRole('spinbutton', { name: text.exp }))
  await user.type(screen.getByRole('spinbutton', { name: text.exp }), '100000')
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.recoveryPlan('CE-6', false))).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: text.books }))
  await user.clear(screen.getByRole('spinbutton', { name: text.bookNames[3] }))
  await user.type(screen.getByRole('spinbutton', { name: text.bookNames[3] }), '20')
  expect(screen.getByText(text.recoveryPlan('CE-6', false))).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(within(screen.getByLabelText(text.result)).getByText('40,000')).toBeInTheDocument()
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  expect(screen.getByRole('button', { name: text.applyManual })).toBeDisabled()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  expect(await screen.findByText(text.importedSource)).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.manual }))
  expect(within(screen.getByLabelText(text.result)).getByText('40,000')).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: text.lmd })).toHaveValue(null)
})

it('allows manual advice without a binding and when the stock import fails', async () => {
  const user = userEvent.setup()
  const rendered = render(view(session('first', false)))
  expect(mocks.api).not.toHaveBeenCalled()
  await user.click(screen.getByRole('tab', { name: text.manual }))
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.focus.empty)).toBeInTheDocument()
  mocks.stock.mockRejectedValueOnce(new Error(text.importFailed))
  rendered.rerender(view(session('second')))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.importFailed)
  await user.click(screen.getByRole('tab', { name: text.manual }))
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.focus.empty)).toBeInTheDocument()
})

it('does not show fixed-ratio advice when training data fails or module information is incomplete', async () => {
  const user = userEvent.setup()
  mocks.catalog.mockRejectedValueOnce(new Error(text.targetsFailed))
  render(view())
  expect(await screen.findByRole('alert')).toHaveTextContent(text.targetsFailed)
  expect(screen.getByLabelText(text.accountReference)).not.toHaveTextContent(text.referenceValue)
  mocks.catalog.mockResolvedValueOnce({ ...account, operators: [{ ...account.operators[0], modules: [{ ...account.operators[0].modules[0], current: null }] }] })
  await user.click(screen.getByRole('button', { name: text.retryTargets }))
  await screen.findByText(text.accountFocus.exp)
  await user.click(within(screen.getByRole('group', { name: text.modules })).getByLabelText(text.moduleChoices.all))
  expect(screen.getByText(text.incomplete)).toBeInTheDocument()
  expect(screen.getByText(text.issueReasons.modules)).toBeInTheDocument()
  expect(screen.queryByText(text.accountFocus.exp)).not.toBeInTheDocument()
})

it('ignores late training responses after an account change and isolates saved goals', async () => {
  let finish!: (value: TrainingAccountData) => void
  mocks.catalog.mockImplementationOnce(() => new Promise<TrainingAccountData>((resolve) => { finish = resolve }))
  sessionStorage.setItem('maatool:training-ratio:user1:second:goals', JSON.stringify({ low: 'none', four: 'none', five: 'none', six: 'none', modules: 'none', moduleLevel: 1 }))
  const rendered = render(view())
  await screen.findAllByText(text.targetsLoading)
  rendered.rerender(view(session('second')))
  expect(await screen.findByText(text.accountFocus.ready)).toBeInTheDocument()
  await act(async () => finish(account))
  expect(screen.getByText(text.accountFocus.ready)).toBeInTheDocument()
  expect(screen.queryByText(text.accountFocus.exp)).not.toBeInTheDocument()
})

it('preserves manual output when a pending stock import finishes and refreshes account requirements with a new snapshot', async () => {
  const user = userEvent.setup()
  let finish!: (value: SklandSnapshot) => void
  mocks.stock.mockImplementationOnce(() => new Promise<SklandSnapshot>((resolve) => { finish = resolve }))
  render(view())
  await user.click(screen.getByRole('tab', { name: text.manual }))
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  await act(async () => finish(data))
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  await screen.findByText(text.accountFocus.exp)
  mocks.stock.mockResolvedValueOnce({ ...data, version: '2' })
  mocks.catalog.mockResolvedValueOnce({ ...account, snapshotVersion: '2', inventory: { lmd: 9999999, exp: 9999999 } })
  await user.click(screen.getByRole('button', { name: copy.skland.refresh }))
  expect(await screen.findByText(text.accountFocus.ready)).toBeInTheDocument()
  expect(mocks.catalog).toHaveBeenCalledTimes(2)
})

it('uses the current schedule income and ignores the previous account income response', async () => {
  let finish!: (value: WorkspaceResultHistoryItem) => void
  mocks.result.mockImplementationOnce(() => new Promise<WorkspaceResultHistoryItem>((resolve) => { finish = resolve }))
  mocks.result.mockResolvedValueOnce(production(65000, 20000))
  const rendered = render(view(withProduction()))
  expect(await screen.findByText(text.recoveryLoading)).toBeInTheDocument()
  rendered.rerender(view(withProduction('second', 'plan2')))
  expect(await screen.findByText(text.baseIncome('65,000', '20,000'))).toBeInTheDocument()
  expect(mocks.result).toHaveBeenLastCalledWith('second', 'plan2', expect.any(AbortSignal))
  expect(screen.getByText(text.baseSource('second', 'plan2'))).toBeInTheDocument()
  await act(async () => finish(production(100000, 0)))
  expect(screen.getByText(text.baseIncome('65,000', '20,000'))).toBeInTheDocument()
})
