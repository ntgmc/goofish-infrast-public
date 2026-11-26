// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApiJson } from '../../../lib/admin-api-client'
import { useAdminUserList } from './useAdminUserList'

vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: vi.fn() }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

const options = {
  adminUsername: 'operator', capabilities: ['user_view' as const], enabled: true,
  setBusyAction: vi.fn(), setError: vi.fn(), setNotice: vi.fn(), closeDetail: vi.fn(),
}
const page = (number: number) => ({
  app_users: [{ id: `user-page-${number}` }],
  pagination: { page: number, page_size: 25, total: 50, total_pages: 2 },
})

describe('admin user queries', () => {
  it('cancels an obsolete page and prevents its late response from overwriting the current page', async () => {
    let finish!: (value: unknown) => void
    let signal!: AbortSignal
    vi.mocked(adminApiJson)
      .mockImplementationOnce((_url, init) => {
        signal = init!.signal!
        return new Promise((resolve) => { finish = resolve })
      })
      .mockResolvedValueOnce(page(2))
    const { result } = renderHook(() => useAdminUserList(options))
    act(() => result.current.setUserPage(2))
    await waitFor(() => expect(result.current.appUsers[0]?.id).toBe('user-page-2'))
    expect(signal.aborted).toBe(true)
    await act(async () => finish(page(1)))
    expect(result.current.appUsers[0]?.id).toBe('user-page-2')
  })

  it('reuses cached pages and invalidates every cached page after a change', async () => {
    vi.mocked(adminApiJson).mockImplementation(async (url) => page(Number(new URL(url, 'https://example.test').searchParams.get('page'))))
    const { result } = renderHook(() => useAdminUserList(options))
    await waitFor(() => expect(result.current.appUsers[0]?.id).toBe('user-page-1'))
    act(() => result.current.setUserPage(2))
    await waitFor(() => expect(result.current.appUsers[0]?.id).toBe('user-page-2'))
    act(() => result.current.setUserPage(1))
    await waitFor(() => expect(result.current.appUsers[0]?.id).toBe('user-page-1'))
    expect(adminApiJson).toHaveBeenCalledTimes(2)

    await act(async () => { await result.current.loadUsersPage() })
    expect(adminApiJson).toHaveBeenCalledTimes(3)
    act(() => result.current.setUserPage(2))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(4))
  })

  it('marks pending searches busy immediately and applies only the final input on the first page', async () => {
    vi.mocked(adminApiJson).mockImplementation(async (url) => page(Number(new URL(url, 'https://example.test').searchParams.get('page'))))
    const { result } = renderHook(() => useAdminUserList(options))
    await waitFor(() => expect(result.current.appUsers).toHaveLength(1))
    act(() => result.current.setUserPage(2))
    await waitFor(() => expect(result.current.userPagination.page).toBe(2))
    const requests = vi.mocked(adminApiJson).mock.calls.length
    act(() => result.current.setUserSearchInput('first'))
    expect(result.current.usersLoading).toBe(true)
    act(() => result.current.setUserSearchInput(' final@example.test '))
    expect(adminApiJson).toHaveBeenCalledTimes(requests)
    await waitFor(() => expect(result.current.usersLoading).toBe(false))
    expect(adminApiJson).toHaveBeenCalledTimes(requests + 1)
    const params = new URL(vi.mocked(adminApiJson).mock.lastCall![0], 'https://example.test').searchParams
    expect(params.get('search')).toBe('final@example.test')
    expect(params.get('page')).toBe('1')
  })

  it('clears a read failure when a new search succeeds', async () => {
    vi.mocked(adminApiJson).mockRejectedValueOnce(new Error('List unavailable')).mockResolvedValue(page(1))
    const { result } = renderHook(() => useAdminUserList(options))
    await waitFor(() => expect(options.setError).toHaveBeenLastCalledWith('List unavailable'))
    act(() => result.current.setUserSearchInput('recovered'))
    await waitFor(() => expect(result.current.appUsers).toHaveLength(1))
    await waitFor(() => expect(options.setError).toHaveBeenLastCalledWith(null))
  })

  it('does not expose cached users after changing administrator identity or losing list access', async () => {
    vi.mocked(adminApiJson).mockResolvedValueOnce(page(1)).mockImplementationOnce(() => new Promise(() => {}))
    const { result, rerender } = renderHook(({ adminUsername, enabled }) => useAdminUserList({ ...options, adminUsername, enabled }), {
      initialProps: { adminUsername: 'operator', enabled: true },
    })
    await waitFor(() => expect(result.current.appUsers).toHaveLength(1))
    rerender({ adminUsername: 'another-operator', enabled: true })
    expect(result.current.appUsers).toEqual([])
    rerender({ adminUsername: 'operator', enabled: false })
    expect(result.current.appUsers).toEqual([])
    expect(result.current.usersLoaded).toBe(false)
  })
})
