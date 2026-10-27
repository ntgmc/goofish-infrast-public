// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '../test/query-render'
import { afterEach, expect, it, vi } from 'vitest'
import { apiJson } from './api-client'
import { updateUserAnnouncementQueries, useAnnouncementPageQuery, useUserAnnouncementsQuery, userAnnouncementsKey } from './announcement-query'
import type { AnnouncementPageResponse, UserAnnouncementRead } from './types'

vi.mock('./api-client', () => ({ apiJson: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const item: UserAnnouncementRead = { announcement: {
  id: 'notice', kind: 'popup', active: true, title: 'Notice', body: 'Body', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}, read_at: null }
const unread = { announcements: [item], unread_count: 1 }
const read = { announcements: [{ ...item, read_at: item.announcement.updated_at }], unread_count: 0 }
const page: AnnouncementPageResponse = { ...unread, page: 1, pageSize: 10, total: 1 }

it('isolates accounts, cancels old reads and never exposes private data through the public feed', async () => {
  const requests: Array<{ signal?: AbortSignal | null; finish: (data: unknown) => void }> = []
  vi.mocked(apiJson).mockImplementation((_url, options) => new Promise((finish) => requests.push({ signal: options?.signal, finish })))
  const { result, rerender } = renderHook(({ userId }) => ({
    full: useUserAnnouncementsQuery(userId), page: useAnnouncementPageQuery(userId, 1, false, ''),
  }), { initialProps: { userId: 'alice' as string | null } })
  rerender({ userId: 'bob' })
  expect(requests[0].signal?.aborted).toBe(true)
  expect(requests[1].signal?.aborted).toBe(true)
  expect(result.current.full.data).toBeUndefined()
  expect(result.current.page.data).toBeUndefined()
  await act(async () => {
    requests[0].finish(unread)
    requests[1].finish(page)
    requests[2].finish(read)
    requests[3].finish({ ...page, ...read })
  })
  await waitFor(() => expect(result.current.page.data?.unread_count).toBe(0))
  rerender({ userId: null })
  expect(result.current.full.data).toBeUndefined()
  expect(result.current.page.data).toBeUndefined()
  expect(apiJson).toHaveBeenLastCalledWith('/api/announcement?page=1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  await act(async () => requests[4].finish(page))
  await waitFor(() => expect(result.current.page.data?.announcements[0].read_at).toBeNull())
  expect(result.current.full.data).toBeUndefined()
})

it('cancels stale reads before writing a full snapshot, refreshes active pages and invalidates only the same user', async () => {
  let finishOld!: (data: unknown) => void
  vi.mocked(apiJson).mockImplementation(async (url) => url.includes('?page=') ? page : unread)
  const { result } = renderHook(() => ({
    full: useUserAnnouncementsQuery('alice'), page: useAnnouncementPageQuery('alice', 1, false, ''), client: useQueryClient(),
  }))
  await waitFor(() => expect(result.current.full.data).toEqual(unread))
  await waitFor(() => expect(result.current.page.data).toEqual(page))
  const inactivePage = [...userAnnouncementsKey('alice'), 'page', 2, true]
  const otherUser = [...userAnnouncementsKey('bob'), 'all']
  const publicPage = ['public', 'announcements', 'page', 1, false]
  const admin = ['admin', 'alice', 'announcement', []]
  for (const key of [inactivePage, otherUser, publicPage, admin]) result.current.client.setQueryData(key, page)
  vi.mocked(apiJson).mockImplementationOnce(() => new Promise((finish) => { finishOld = finish }))
    .mockResolvedValue({ ...page, ...read })
  let oldRead!: Promise<unknown>
  act(() => { oldRead = result.current.full.refetch() })
  const oldSignal = vi.mocked(apiJson).mock.calls[2][1]?.signal
  await act(async () => {
    await updateUserAnnouncementQueries(result.current.client, 'alice', read)
    finishOld(unread)
    await oldRead
  })
  expect(oldSignal?.aborted).toBe(true)
  await waitFor(() => expect(result.current.full.data).toEqual(read))
  await waitFor(() => expect(result.current.page.data?.unread_count).toBe(0))
  expect(result.current.client.getQueryState(inactivePage)?.isInvalidated).toBe(true)
  for (const key of [otherUser, publicPage, admin]) expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(false)
  expect(vi.mocked(apiJson).mock.calls.filter(([url]) => url === '/api/user/announcements')).toHaveLength(2)
})

it('keeps a located page stale when normalizing an older cached direct link', async () => {
  const located = { ...page, page: 3 }
  vi.mocked(apiJson).mockResolvedValue(located)
  const { result, rerender } = renderHook(({ requestedPage, id }) => ({
    page: useAnnouncementPageQuery('alice', requestedPage, false, id), client: useQueryClient(),
  }), { initialProps: { requestedPage: 1, id: 'notice' } })
  await waitFor(() => expect(result.current.page.data?.page).toBe(3))
  await act(async () => {
    result.current.client.setQueryData([...userAnnouncementsKey('alice'), 'page', 1, false, 'notice'], located, { updatedAt: Date.now() - 60_000 })
  })
  await waitFor(() => expect(result.current.client.getQueryState([...userAnnouncementsKey('alice'), 'page', 3, false])?.dataUpdatedAt).toBeLessThan(Date.now() - 30_000))
  vi.mocked(apiJson).mockResolvedValue({ ...located, unread_count: 0 })
  rerender({ requestedPage: 3, id: '' })
  await waitFor(() => expect(result.current.page.data?.unread_count).toBe(0))
  expect(apiJson).toHaveBeenCalledTimes(2)
})

it('retains a successful snapshot on read failure and does not recreate cleared private caches after a late mutation', async () => {
  vi.mocked(apiJson).mockResolvedValue(unread)
  const { result } = renderHook(() => ({ full: { ...useUserAnnouncementsQuery('alice') }, client: useQueryClient() }))
  await waitFor(() => expect(result.current.full.data).toEqual(unread))
  vi.mocked(apiJson).mockRejectedValue(new Error('Read unavailable'))
  await act(async () => { await updateUserAnnouncementQueries(result.current.client, 'alice', { unread_count: 0 }) })
  await waitFor(() => expect(result.current.full.error?.message).toBe('Read unavailable'))
  expect(result.current.full.data).toEqual(unread)
  expect(apiJson).toHaveBeenCalledTimes(2)
  await act(async () => {
    result.current.client.removeQueries({ queryKey: ['user'] })
    await updateUserAnnouncementQueries(result.current.client, 'alice', read)
  })
  expect(result.current.client.getQueriesData({ queryKey: ['user'] })).toEqual([])
})
