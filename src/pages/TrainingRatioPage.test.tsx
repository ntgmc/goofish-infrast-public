// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../copy'
import type { SklandSnapshot } from '../lib/skland-snapshot'
import type { WorkspaceResultHistoryItem } from '../lib/types'
import { syncSklandSnapshotSession } from '../lib/skland-snapshot-client'
import type { useToolSession } from './tool/useToolSession'
import TrainingRatioPage from './TrainingRatioPage'

const mocks = vi.hoisted(() => ({ api: vi.fn(), result: vi.fn() }))
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
beforeEach(() => {
  syncSklandSnapshotSession({ user: { id: 'reset' }, profiles: [] } as never); syncSklandSnapshotSession(null)
  localStorage.clear(); sessionStorage.clear(); mocks.api.mockResolvedValue(data)
  mocks.result.mockResolvedValue({ result: {} })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('imports stock by default without targets and keeps imported data out of the manual draft', async () => {
  const user = userEvent.setup()
  localStorage.setItem('maatool:cultivation-projects:user1:first', '[broken')
  render(view())
  expect(await screen.findByText(text.recoveryDays('1'))).toBeInTheDocument()
  expect(screen.getByText(text.recoveryPlan('LS-6', false))).toBeInTheDocument()
  expect(screen.getByText(text.noBaseIncome)).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledTimes(1)
  expect(mocks.api).toHaveBeenCalledWith('/api/user/skland/snapshot?profile_id=first', expect.any(Object))
  expect(screen.getByText(text.importedSource)).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: text.lmd, hidden: true })).not.toBeVisible()
  expect(localStorage.getItem('maatool:cultivation-projects:user1:first')).toBe('[broken')
  expect(sessionStorage.getItem('maatool:training-ratio:user1:first')).not.toContain('200000')
  await user.click(screen.getByRole('button', { name: copy.skland.refresh }))
  expect(mocks.api).toHaveBeenCalledTimes(2)
})

it('switches input and results together through source tabs while preserving each calculation', async () => {
  const user = userEvent.setup()
  render(view())
  await screen.findByText(text.importedSource)
  expect(screen.getByRole('tab', { name: text.accountInventory })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: text.manual }))
  expect(screen.getByRole('tab', { name: text.manual })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('combobox', { name: text.account })).not.toBeInTheDocument()
  expect(screen.queryByText(text.importedSource)).not.toBeInTheDocument()
  expect(screen.getByText(text.noManualInventory)).toBeInTheDocument()
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  await user.type(screen.getByRole('spinbutton', { name: text.lmd }), '100000')
  await user.clear(screen.getByRole('spinbutton', { name: text.exp }))
  await user.type(screen.getByRole('spinbutton', { name: text.exp }), '100000')
  expect(screen.getByText(text.noManualInventory)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  expect(screen.getByText(text.recoveryPlan('CE-6', false))).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: text.books }))
  await user.clear(screen.getByRole('spinbutton', { name: text.bookNames[3] }))
  await user.type(screen.getByRole('spinbutton', { name: text.bookNames[3] }), '20')
  expect(screen.getByText(text.recoveryPlan('CE-6', false))).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(within(screen.getByLabelText(text.result)).getByText('40,000')).toBeInTheDocument()
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  expect(screen.getByRole('button', { name: text.applyManual })).toBeDisabled()
  expect(within(screen.getByLabelText(text.result)).getByText('40,000')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  expect(screen.getByText(text.importedSource)).toBeInTheDocument()
  expect(within(screen.getByLabelText(text.result)).getByText('200,000')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.manual }))
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  expect(within(screen.getByLabelText(text.result)).getByText('40,000')).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: text.lmd })).toHaveValue(null)
  expect(mocks.api).toHaveBeenCalledTimes(1)
})

it('allows explicit manual advice without binding and after an automatic import fails', async () => {
  const user = userEvent.setup()
  const rendered = render(view(session('first', false)))
  expect(mocks.api).not.toHaveBeenCalled()
  await user.click(screen.getByText(text.manual, { exact: true }))
  expect(screen.queryByText(text.manualSource)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.focus.empty)).toBeInTheDocument()
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  mocks.api.mockRejectedValueOnce(new Error(text.importFailed))
  rendered.rerender(view(session('second')))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.importFailed)
  await user.click(screen.getByText(text.manual, { exact: true }))
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.focus.empty)).toBeInTheDocument()
})

it('preserves the manual tab and its result when a pending import or a later refresh returns', async () => {
  const user = userEvent.setup()
  let finish!: (value: SklandSnapshot) => void
  mocks.api.mockImplementationOnce(() => new Promise<SklandSnapshot>((resolve) => { finish = resolve }))
  render(view())
  await user.click(screen.getByRole('tab', { name: text.manual }))
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  await act(async () => finish(data))
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  expect(screen.getByText(text.focus.empty)).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  mocks.api.mockImplementationOnce(() => new Promise<SklandSnapshot>((resolve) => { finish = resolve }))
  await user.click(screen.getByRole('button', { name: copy.skland.refresh }))
  await user.click(screen.getByRole('tab', { name: text.manual }))
  await act(async () => finish(data))
  expect(mocks.api).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('tab', { name: text.manual })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  expect(screen.getByText(text.importedSource)).toBeInTheDocument()
  expect(screen.getByText(text.recoveryDays('1'))).toBeInTheDocument()
})

it('uses the current account schedule income and ignores a previous account response', async () => {
  let finish!: (value: WorkspaceResultHistoryItem) => void
  mocks.result.mockImplementationOnce(() => new Promise<WorkspaceResultHistoryItem>((resolve) => { finish = resolve }))
  mocks.result.mockResolvedValueOnce(production(65000, 20000))
  mocks.api.mockResolvedValue({ ...data, inventory: { ...data.inventory, lmd: 13000000, exp: 0 } })
  const rendered = render(view(withProduction()))
  expect(await screen.findByText(text.recoveryLoading)).toBeInTheDocument()
  rendered.rerender(view(withProduction('second', 'plan2')))
  expect(await screen.findByText(text.recoveryDays('291'))).toBeInTheDocument()
  expect(mocks.result).toHaveBeenLastCalledWith('second', 'plan2', expect.any(AbortSignal))
  expect(screen.getByText(text.baseIncome('65,000', '20,000'))).toBeInTheDocument()
  expect(screen.getByText(text.baseSource('second', 'plan2'))).toBeInTheDocument()
  expect(screen.getByText(text.recoveryPlan('LS-6', true))).toBeInTheDocument()
  await act(async () => finish(production(100000, 0)))
  expect(screen.getByText(text.recoveryDays('291'))).toBeInTheDocument()
  expect(screen.queryByText(text.recoveryBlocked)).not.toBeInTheDocument()
})

it('falls back to farming only when income fails and reports a non-converging base forecast', async () => {
  mocks.result.mockRejectedValueOnce(new Error('unavailable'))
  const rendered = render(view(withProduction()))
  expect(await screen.findByText(text.baseIncomeFailed)).toBeInTheDocument()
  expect(screen.getByText(text.recoveryDays('1'))).toBeInTheDocument()
  mocks.result.mockResolvedValueOnce(production(100000, 0))
  rendered.rerender(view(withProduction('first', 'plan2')))
  expect(await screen.findByText(text.recoveryBlocked)).toBeInTheDocument()
  expect(screen.queryByText(text.recoveryDays('1'))).not.toBeInTheDocument()
})

it('isolates account changes while allowing the shared request to finish for its original account', async () => {
  let finish!: (value: SklandSnapshot) => void
  mocks.api.mockImplementationOnce(() => new Promise<SklandSnapshot>((resolve) => { finish = resolve }))
  const rendered = render(view())
  rendered.rerender(view(session('second')))
  await screen.findByText(text.recoveryDays('1'))
  await act(async () => finish({ ...data, inventory: { ...data.inventory, lmd: 0, exp: 100000 } }))
  expect(screen.getByLabelText(text.result)).toHaveTextContent(text.focus.exp)
  expect(screen.getByLabelText(text.result)).not.toHaveTextContent(text.focus.lmd)
})
