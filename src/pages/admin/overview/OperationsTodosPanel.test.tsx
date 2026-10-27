// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '../../../test/query-render'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OperationsTodos } from '../../../lib/operations-drilldown'
import type { AdminCapability } from '../contracts'
import OperationsTodosPanel from './OperationsTodosPanel'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
const identity = { adminUsername: 'operator', capabilities: ['usage_view', 'user_view', 'risk_view', 'optimization_view'] as AdminCapability[], active: true, refreshKey: 'report-1' }
const snapshot: OperationsTodos = { generated_at: '2026-10-01T00:00:00Z', feedback_unassigned: 12, feedback_reply: 13, risk_pending: 14, abnormal_jobs: 15 }

beforeEach(() => { api.mockReset().mockResolvedValue(snapshot) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shares a pending request, retains it while another consumer remains and reuses the fresh snapshot', async () => {
  let finish!: (data: OperationsTodos) => void
  api.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const content = (firstActive: boolean) => <MemoryRouter>
    <OperationsTodosPanel {...identity} active={firstActive} />
    <OperationsTodosPanel {...identity} />
  </MemoryRouter>
  const view = render(content(true))
  expect(api).toHaveBeenCalledOnce()
  const signal = api.mock.calls[0][1].signal as AbortSignal
  view.rerender(content(false))
  expect(signal.aborted).toBe(false)
  await act(async () => finish(snapshot))
  await screen.findByText('12')
  view.rerender(content(true))
  await waitFor(() => expect(screen.getAllByText('12')).toHaveLength(2))
  expect(api).toHaveBeenCalledOnce()
})

it('cancels an obsolete report-linked read, discards its late response and reuses cached report snapshots', async () => {
  let finish!: (data: OperationsTodos) => void
  api.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue({ ...snapshot, feedback_unassigned: 21 })
  const content = (refreshKey: string) => <MemoryRouter><OperationsTodosPanel {...identity} refreshKey={refreshKey} /></MemoryRouter>
  const view = render(content('report-1'))
  const signal = api.mock.calls[0][1].signal as AbortSignal
  view.rerender(content('report-2'))
  expect(signal.aborted).toBe(true)
  await screen.findByText('21')
  await act(async () => finish(snapshot))
  expect(screen.queryByText('12')).not.toBeInTheDocument()
  api.mockResolvedValue(snapshot)
  view.rerender(content('report-1'))
  await screen.findByText('12')
  expect(api).toHaveBeenCalledTimes(3)
  view.rerender(content('report-2'))
  await screen.findByText('21')
  expect(api).toHaveBeenCalledTimes(3)
})

it('isolates administrators and capabilities, clears old numbers and detaches when inactive', async () => {
  const pending: Array<{ finish: (data: OperationsTodos) => void; signal: AbortSignal }> = []
  api.mockImplementation((_url, { signal }) => new Promise((finish) => pending.push({ finish, signal })))
  const content = (adminUsername: string | null, capabilities = identity.capabilities, active = true) => <MemoryRouter>
    <OperationsTodosPanel {...identity} adminUsername={adminUsername} capabilities={capabilities} active={active} />
  </MemoryRouter>
  const view = render(content('first'))
  view.rerender(content('second'))
  expect(pending[0].signal.aborted).toBe(true)
  view.rerender(content('second', ['usage_view', 'user_view']))
  expect(pending[1].signal.aborted).toBe(true)
  await act(async () => {
    pending[0].finish(snapshot)
    pending[1].finish(snapshot)
    pending[2].finish({ ...snapshot, feedback_unassigned: 31 })
  })
  await screen.findByText('31')
  expect(screen.queryByText('12')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /待复核风险/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /待认领反馈/ })).toHaveAttribute('href', expect.stringContaining('todo=unassigned'))
  view.rerender(content('second', ['usage_view', 'user_view'], false))
  expect(screen.queryByText('31')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '刷新待办' })).toBeDisabled()
  expect(api).toHaveBeenCalledTimes(3)
})

it.each([
  { adminUsername: null, capabilities: identity.capabilities },
  { adminUsername: 'operator', capabilities: ['user_view'] as AdminCapability[] },
])('disables automatic and manual requests without the required identity and capability ($adminUsername)', async (props) => {
  render(<MemoryRouter><OperationsTodosPanel {...identity} {...props} /></MemoryRouter>)
  const refresh = screen.getByRole('button', { name: '刷新待办' })
  expect(refresh).toBeDisabled()
  fireEvent.click(refresh)
  await act(async () => {})
  expect(api).not.toHaveBeenCalled()
})

it('allows explicitly retrying a read failure and updates the counts without changing drilldown destinations', async () => {
  render(<MemoryRouter><OperationsTodosPanel {...identity} /></MemoryRouter>)
  await screen.findByText('12')
  const link = screen.getByRole('link', { name: /待认领反馈/ })
  const destination = link.getAttribute('href')
  api.mockRejectedValueOnce(new Error('Todos unavailable'))
  fireEvent.click(screen.getByRole('button', { name: '刷新待办' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Todos unavailable')
  expect(within(link).getByText('—')).toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(2)
  api.mockResolvedValue({ ...snapshot, feedback_unassigned: 41 })
  fireEvent.click(screen.getByRole('button', { name: '刷新待办' }))
  await screen.findByText('41')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(link).toHaveAttribute('href', destination)
  expect(api).toHaveBeenCalledTimes(3)
})
