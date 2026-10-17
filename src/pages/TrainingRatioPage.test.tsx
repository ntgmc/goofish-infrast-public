// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../copy'
import type { SklandSnapshot } from '../lib/skland-snapshot'
import { syncSklandSnapshotSession } from '../lib/skland-snapshot-client'
import type { useToolSession } from './tool/useToolSession'
import TrainingRatioPage from './TrainingRatioPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api-client', async (original) => ({ ...await original<typeof import('../lib/api-client')>(), apiJson: mocks.api }))
const text = copy.trainingRatio
function session(id = 'first', bound = true) {
  return { user: { id: 'user1' }, activeProfile: { id, display_name: id, status: 'active', skland_binding: bound ? { uid: id, credential_status: 'available' } : null }, profiles: [{ id, display_name: id, status: 'active' }] } as unknown as ReturnType<typeof useToolSession>
}
const view = (current = session()) => <MemoryRouter><TrainingRatioPage session={current} embedded /></MemoryRouter>
const data = { uid: 'first', version: '1', game: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null },
  inventory: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null, items: { '4001': 200000, '2004': 50 }, lmd: 200000, exp: 100000 }, retryAt: null } as SklandSnapshot
beforeEach(() => {
  syncSklandSnapshotSession({ user: { id: 'reset' }, profiles: [] } as never); syncSklandSnapshotSession(null)
  localStorage.clear(); sessionStorage.clear(); mocks.api.mockResolvedValue(data)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('imports stock by default without targets and keeps imported data out of the manual draft', async () => {
  const user = userEvent.setup()
  localStorage.setItem('maatool:cultivation-projects:user1:first', '[broken')
  render(view())
  expect(await screen.findByText(text.supplementExp('53,847'))).toBeInTheDocument()
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
  expect(screen.getByText(text.supplementLmd('30,000'))).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: text.books }))
  await user.clear(screen.getByRole('spinbutton', { name: text.bookNames[3] }))
  await user.type(screen.getByRole('spinbutton', { name: text.bookNames[3] }), '20')
  expect(screen.getByText(text.supplementLmd('30,000'))).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.applyManual }))
  expect(screen.getByText(text.supplementExp('36,924'))).toBeInTheDocument()
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  expect(screen.getByRole('button', { name: text.applyManual })).toBeDisabled()
  expect(screen.getByText(text.supplementExp('36,924'))).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.accountInventory }))
  expect(screen.getByText(text.importedSource)).toBeInTheDocument()
  expect(screen.getByText(text.supplementExp('53,847'))).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: text.manual }))
  expect(screen.getByText(text.manualSource)).toBeInTheDocument()
  expect(screen.getByText(text.supplementExp('36,924'))).toBeInTheDocument()
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
  expect(screen.getByText(text.supplementExp('53,847'))).toBeInTheDocument()
})

it('isolates account changes while allowing the shared request to finish for its original account', async () => {
  let finish!: (value: SklandSnapshot) => void
  mocks.api.mockImplementationOnce(() => new Promise<SklandSnapshot>((resolve) => { finish = resolve }))
  const rendered = render(view())
  rendered.rerender(view(session('second')))
  await screen.findByText(text.supplementExp('53,847'))
  await act(async () => finish({ ...data, inventory: { ...data.inventory, lmd: 0, exp: 100000 } }))
  expect(screen.getByLabelText(text.result)).toHaveTextContent(text.focus.exp)
  expect(screen.getByLabelText(text.result)).not.toHaveTextContent(text.focus.lmd)
})
