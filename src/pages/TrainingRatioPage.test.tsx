// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../copy'
import type { CultivationData } from '../lib/cultivation-contract'
import type { useToolSession } from './tool/useToolSession'
import TrainingRatioPage from './TrainingRatioPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api-client', () => ({ apiJson: mocks.api }))
const text = copy.trainingRatio
function session(id = 'first', bound = true) {
  return { user: { id: 'user1' }, activeProfile: { id, display_name: id, status: 'active', skland_binding: bound ? {} : null }, profiles: [{ id, display_name: id, status: 'active' }] } as unknown as ReturnType<typeof useToolSession>
}
const view = (current = session()) => <MemoryRouter><TrainingRatioPage session={current} embedded /></MemoryRouter>
const data = { inventory: { '4001': 200000, exp: 100000 }, importedAt: '2026-10-17T00:00:00Z' } as unknown as CultivationData
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); mocks.api.mockResolvedValue(data) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('imports stock by default without targets and keeps imported data out of the manual draft', async () => {
  const user = userEvent.setup()
  localStorage.setItem('maatool:cultivation-projects:user1:first', '[broken')
  render(view())
  expect(await screen.findByText(text.supplementExp('53,847'))).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledTimes(1)
  expect(mocks.api).toHaveBeenCalledWith('/api/cultivation-plan', expect.objectContaining({ json: { profile_id: 'first', projects: [] } }))
  expect(screen.getByText(text.importedSource)).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: text.lmd, hidden: true })).not.toBeVisible()
  expect(localStorage.getItem('maatool:cultivation-projects:user1:first')).toBe('[broken')
  expect(sessionStorage.getItem('maatool:training-ratio:user1:first')).not.toContain('200000')
  await user.click(screen.getByRole('button', { name: text.refresh }))
  expect(mocks.api).toHaveBeenCalledTimes(2)
})

it('uses manual entry as a supplement and restores imported advice when it closes', async () => {
  const user = userEvent.setup()
  render(view())
  await screen.findByText(text.importedSource)
  await user.click(screen.getByText(text.manual, { exact: true }))
  await screen.findByText(text.manualSource)
  await user.clear(screen.getByRole('spinbutton', { name: text.lmd }))
  await user.type(screen.getByRole('spinbutton', { name: text.lmd }), '100000')
  await user.clear(screen.getByRole('spinbutton', { name: text.exp }))
  await user.type(screen.getByRole('spinbutton', { name: text.exp }), '100000')
  expect(screen.getByText(text.supplementLmd('30,000'))).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: text.books }))
  await user.clear(screen.getByRole('spinbutton', { name: text.bookNames[3] }))
  await user.type(screen.getByRole('spinbutton', { name: text.bookNames[3] }), '20')
  expect(screen.getByText(text.supplementExp('36,924'))).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText(text.manual, { exact: true }))
  expect(await screen.findByText(text.importedSource)).toBeInTheDocument()
  expect(screen.getByText(text.supplementExp('53,847'))).toBeInTheDocument()
})

it('allows manual advice without binding and after an automatic import fails', async () => {
  const user = userEvent.setup()
  const rendered = render(view(session('first', false)))
  expect(mocks.api).not.toHaveBeenCalled()
  await user.click(screen.getByText(text.manual, { exact: true }))
  expect(await screen.findByText(text.focus.empty)).toBeInTheDocument()
  mocks.api.mockRejectedValueOnce(new Error(text.importFailed))
  rendered.rerender(view(session('second')))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.importFailed)
  await user.click(screen.getByText(text.manual, { exact: true }))
  expect(await screen.findByText(text.focus.empty)).toBeInTheDocument()
})

it('aborts an automatic import on account changes and ignores the old response', async () => {
  let finish!: (value: CultivationData) => void
  let signal!: AbortSignal
  mocks.api.mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise<CultivationData>((resolve) => { finish = resolve }) })
  const rendered = render(view())
  rendered.rerender(view(session('second')))
  expect(signal.aborted).toBe(true)
  await screen.findByText(text.supplementExp('53,847'))
  await act(async () => finish({ ...data, inventory: { '4001': 0, exp: 100000 } }))
  expect(screen.getByLabelText(text.result)).toHaveTextContent(text.focus.exp)
  expect(screen.getByLabelText(text.result)).not.toHaveTextContent(text.focus.lmd)
})
