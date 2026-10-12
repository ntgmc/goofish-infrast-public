// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { AnnouncementPageResponse, UserAnnouncementRead } from '../../../lib/types'
import type { V2Session } from '../OptionsDrawer'
import Announcements from './Announcements'

const mocks = vi.hoisted(() => ({ api: vi.fn(), unread: vi.fn() }))
vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (_error: unknown, fallback: string) => fallback }))

let items: UserAnnouncementRead[]
function pageData(page: number, unreadOnly = false): AnnouncementPageResponse {
  const visible = items.filter((item) => !unreadOnly || !item.read_at)
  return {
    announcements: visible.slice((page - 1) * 10, page * 10), page, pageSize: 10, total: visible.length,
    unread_count: items.filter((item) => !item.read_at).length,
  }
}

beforeEach(() => {
  items = Array.from({ length: 23 }, (_, index) => ({
    announcement: {
      id: `popup-${index}`, kind: 'popup', active: true, title: `Announcement ${index}`, body: `Body ${index}`,
      created_at: '2026-10-01T00:00:00Z', updated_at: new Date(Date.UTC(2026, 9, 23 - index)).toISOString(),
    }, read_at: null,
  }))
  mocks.api.mockImplementation(async (url: string, init: { method?: string; json?: { announcement_id?: string } } = {}) => {
    const params = new URL(url, 'https://example.test').searchParams
    if (init.method === 'PATCH') items = items.map((item) => (!init.json?.announcement_id || init.json.announcement_id === item.announcement.id)
      ? { ...item, read_at: item.announcement.updated_at } : item)
    const unreadOnly = params.get('unread_only') === '1'
    const visible = items.filter((item) => !unreadOnly || !item.read_at)
    const index = visible.findIndex((item) => item.announcement.id === params.get('announcement_id'))
    const requested = Math.min(Number(params.get('page')), Math.max(1, Math.ceil(visible.length / 10)))
    return pageData(index >= 0 ? Math.floor(index / 10) + 1 : requested, unreadOnly)
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

function RouteControls() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button><button onClick={() => navigate('/v2?section=announcements&page=2')}>Jump</button></>
}

function mount(path = '/v2?section=announcements&profile_id=doctor', signedIn = false) {
  const session = { user: signedIn ? { id: 'user-1' } : null, setAnnouncementUnreadCount: mocks.unread, announcementUnreadCount: 23 } as unknown as V2Session
  return render(<MemoryRouter initialEntries={[path]}><Announcements session={session} /><RouteControls /></MemoryRouter>)
}

it('loads one page, renders only the selected body, and restores page and selection through history', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByRole('heading', { name: 'Announcement 0' })
  const index = screen.getByRole('navigation', { name: copy.v2.announcements })
  expect(within(index).getAllByRole('button')).toHaveLength(10)
  expect(screen.queryByText('Body 1')).not.toBeInTheDocument()
  await user.click(within(index).getByRole('button', { name: /Announcement 3$/ }))
  expect(screen.getByText('Body 3')).toBeInTheDocument()
  expect(screen.queryByText('Body 0')).not.toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('profile_id=doctor&page=1#announcement-popup-3')
  expect(mocks.api).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: copy.v2.nextPage }))
  await screen.findByRole('heading', { name: 'Announcement 10' })
  expect(within(index).getAllByRole('button')).toHaveLength(10)
  expect(screen.queryByText('Announcement 0')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await screen.findByRole('heading', { name: 'Announcement 3' })
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await screen.findByRole('heading', { name: 'Announcement 10' })
})

it('opens an encoded old announcement directly and normalizes its page without another request', async () => {
  items[21].announcement.id = '公告/21'
  mount('/v2?section=announcements#announcement-%E5%85%AC%E5%91%8A%2F21')
  await screen.findByRole('heading', { name: 'Announcement 21' })
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('page=3#announcement-%E5%85%AC%E5%91%8A%2F21'))
  expect(mocks.api).toHaveBeenCalledTimes(1)
  expect(mocks.api.mock.calls[0][0]).toBe('/api/announcement?page=1&announcement_id=%E5%85%AC%E5%91%8A%2F21')
  expect(screen.queryByText('Announcement 0')).not.toBeInTheDocument()
})

it('ignores a response for a page left while it was loading', async () => {
  let finishFirst!: (data: AnnouncementPageResponse) => void
  mocks.api.mockImplementationOnce(() => new Promise<AnnouncementPageResponse>((resolve) => { finishFirst = resolve }))
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: 'Jump' }))
  await screen.findByRole('heading', { name: 'Announcement 10' })
  expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => { finishFirst(pageData(1)) })
  expect(screen.getByRole('heading', { name: 'Announcement 10' })).toBeInTheDocument()
})

it('keeps the current page after a failed load and retries the requested page', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByRole('heading', { name: 'Announcement 0' })
  mocks.api.mockRejectedValueOnce(new Error('Network request failed'))
  await user.click(screen.getByRole('button', { name: copy.v2.nextPage }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.public.pages_AnnouncementsPage_001)
  expect(screen.getByText('Body 0')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: copy.v2.retry }))
  await screen.findByRole('heading', { name: 'Announcement 10' })
})

it.each(['missing', '%E0%A4%A'])('shows an unavailable or malformed announcement explicitly (%s)', async (id) => {
  mount(`/v2?section=announcements#announcement-${id}`)
  await screen.findByRole('heading', { name: copy.v2.announcementsNotFound })
  expect(screen.queryByText('Body 0')).not.toBeInTheDocument()
})

it('filters unread announcements on the server and marks all pages read', async () => {
  const user = userEvent.setup()
  mount('/v2?section=announcements#announcement-popup-21', true)
  await screen.findByRole('heading', { name: 'Announcement 21' })
  expect(mocks.api.mock.calls[0][0]).toBe('/api/user/announcements?page=1&announcement_id=popup-21')
  await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_011 }))
  expect(mocks.unread).toHaveBeenLastCalledWith(22)
  await user.click(screen.getByRole('button', { name: /未读公告/ }))
  await screen.findByRole('heading', { name: 'Announcement 0' })
  expect(mocks.api.mock.calls[mocks.api.mock.calls.length - 1][0]).toBe('/api/user/announcements?page=1&unread_only=1')
  await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_011 }))
  await screen.findByRole('heading', { name: 'Announcement 1' })
  expect(mocks.unread).toHaveBeenLastCalledWith(21)
  await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_005 }))
  await screen.findByRole('heading', { name: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_007 })
  expect(mocks.unread).toHaveBeenLastCalledWith(0)
  expect(screen.getByRole('button', { name: copy.v2.nextPage })).toBeDisabled()
})
