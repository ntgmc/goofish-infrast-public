// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '../../../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import type { Announcement } from '../../../lib/types'
import AnnouncementPopup from '../../../components/AnnouncementPopup'
import AnnouncementsSection from './AnnouncementsSection'

vi.mock('../../../lib/api-client', () => ({ apiJson: vi.fn(), apiVoid: vi.fn() }))
const announcement: Announcement = {
  id: 'notice', kind: 'popup', active: true, title: 'Test notice', body: 'Notice body',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', popup_until: '2099-01-01T00:00:00Z',
}
const unread = { announcements: [{ announcement, read_at: null }], unread_count: 1 }
const read = { announcements: [{ announcement, read_at: announcement.updated_at }], unread_count: 0 }

beforeEach(() => {
  window.sessionStorage.clear()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('shares the pending popup read with the list and updates both after explicit acknowledgement', async () => {
  let finish!: (value: typeof unread) => void
  vi.mocked(apiJson).mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue(read)
  const count = vi.fn()
  render(<MemoryRouter>
    <AnnouncementsSection userId="alice" onUnreadCountChange={count} />
    <AnnouncementPopup userId="alice" announcements={[announcement]} onUnreadCountChange={count} />
  </MemoryRouter>)
  expect(apiJson).toHaveBeenCalledOnce()
  await act(async () => finish(unread))
  const dialog = await screen.findByRole('dialog', { name: 'Test notice' })
  await userEvent.click(within(dialog).getByRole('button', { name: '已读' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: '标为已读' })).not.toBeInTheDocument()
  expect(count).toHaveBeenLastCalledWith(0)
  expect(apiJson).toHaveBeenCalledTimes(2)
  expect(apiJson).toHaveBeenLastCalledWith('/api/user/announcements', { method: 'PATCH', json: { announcement_id: 'notice', updated_at: announcement.updated_at } })
})

it('waits for a stale read to succeed before opening a reminder and keeps the cached list if it fails', async () => {
  vi.mocked(apiJson).mockResolvedValue(unread)
  function Refresh() {
    const client = useQueryClient()
    return <button onClick={() => void client.invalidateQueries({ queryKey: ['user'] })}>Refresh</button>
  }
  const count = vi.fn()
  const content = (popup: boolean) => <MemoryRouter>
    <AnnouncementsSection userId="alice" onUnreadCountChange={count} />
    <Refresh />
    {popup && <AnnouncementPopup userId="alice" announcements={[announcement]} />}
  </MemoryRouter>
  const view = render(content(false))
  await screen.findByRole('heading', { name: 'Test notice' })
  let fail!: (reason: Error) => void
  vi.mocked(apiJson).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  view.rerender(content(true))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => fail(new Error('Read unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Read unavailable')
  expect(screen.getByRole('heading', { name: 'Test notice' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(apiJson).toHaveBeenCalledTimes(2)
})

it('ignores a pending acknowledgement after switching accounts and clears its local busy state', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(apiJson).mockResolvedValue(unread)
  const firstCount = vi.fn()
  const secondCount = vi.fn()
  const view = render(<AnnouncementsSection userId="alice" onUnreadCountChange={firstCount} />)
  await screen.findByRole('button', { name: '标为已读' })
  vi.mocked(apiJson).mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue({ announcements: [], unread_count: 0 })
  await userEvent.click(screen.getByRole('button', { name: '标为已读' }))
  const signal = vi.mocked(apiJson).mock.calls[1][1]?.signal
  view.rerender(<AnnouncementsSection userId="bob" onUnreadCountChange={secondCount} />)
  expect(signal?.aborted).toBe(true)
  await waitFor(() => expect(secondCount).toHaveBeenLastCalledWith(0))
  await act(async () => finish(read))
  expect(firstCount).toHaveBeenLastCalledWith(1)
  expect(screen.queryByRole('heading', { name: 'Test notice' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '全部设为已读' })).toBeDisabled()
})

it('keeps acknowledgement submissions manual after a failure and preserves the displayed announcement', async () => {
  vi.mocked(apiJson).mockResolvedValueOnce(unread).mockRejectedValueOnce(new Error('Save unavailable')).mockResolvedValue(read)
  render(<AnnouncementsSection userId="alice" onUnreadCountChange={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '标为已读' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable')
  expect(screen.getByRole('heading', { name: 'Test notice' })).toBeInTheDocument()
  expect(vi.mocked(apiJson).mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '标为已读' })).not.toBeInTheDocument())
  expect(vi.mocked(apiJson).mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(2)
})
