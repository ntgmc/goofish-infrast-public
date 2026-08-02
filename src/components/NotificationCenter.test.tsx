// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { NotificationBell, NotificationCenterProvider } from './NotificationCenter'
import type { UserNotificationPage } from '../lib/types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('NotificationCenter', () => {
  it('opens without marking read, then marks a notification and navigates to inventory', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page(3)))
      .mockResolvedValueOnce(jsonResponse(page(3)))
      .mockResolvedValueOnce(jsonResponse({ unread_count: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderCenter()

    const trigger = await screen.findByRole('button', { name: '通知，3 条未读' })
    await user.click(trigger)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    await user.click(await screen.findByRole('button', { name: /获得新道具/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tool/inventory'))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
  })

  it('caps the badge at 99+ and marks all notifications read explicitly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page(120)))
      .mockResolvedValueOnce(jsonResponse(page(120)))
      .mockResolvedValueOnce(jsonResponse({ unread_count: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderCenter()

    await user.click(await screen.findByRole('button', { name: '通知，120 条未读' }))
    expect(screen.getByText('99+')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部已读' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '通知，无未读消息' })).toBeInTheDocument())
  })

  it('refreshes when the visible window regains focus', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page(1)))
    vi.stubGlobal('fetch', fetchMock)
    renderCenter()
    await screen.findByRole('button', { name: '通知，1 条未读' })

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('does not let an older refresh overwrite a completed read mutation', async () => {
    const staleRefresh = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page(1)))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce(jsonResponse({ unread_count: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderCenter()

    await user.click(await screen.findByRole('button', { name: '通知，1 条未读' }))
    await user.click(await screen.findByRole('button', { name: /获得新道具/ }))
    staleRefresh.resolve(jsonResponse(page(1)))

    await waitFor(() => expect(screen.getByRole('button', { name: '通知，无未读消息' })).toBeInTheDocument())
  })

  it('does not let an old user read mutation overwrite the next user', async () => {
    const staleMutation = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page(1)))
      .mockResolvedValueOnce(jsonResponse(page(1)))
      .mockReturnValueOnce(staleMutation.promise)
      .mockResolvedValueOnce(jsonResponse(page(7)))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const view = renderCenter()

    await user.click(await screen.findByRole('button', { name: '通知，1 条未读' }))
    await user.click(await screen.findByRole('button', { name: /获得新道具/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    view.rerender(center('user-2'))

    await screen.findByRole('button', { name: '通知，7 条未读' })
    staleMutation.resolve(jsonResponse({ unread_count: 0 }))
    await waitFor(() => expect(screen.getByRole('button', { name: '通知，7 条未读' })).toBeInTheDocument())
  })

  it('ignores an old user pagination failure after switching users', async () => {
    const stalePage = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page(1, 'next-page')))
      .mockResolvedValueOnce(jsonResponse(page(1, 'next-page')))
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce(jsonResponse(page(5)))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const view = renderCenter()

    await user.click(await screen.findByRole('button', { name: '通知，1 条未读' }))
    await user.click(await screen.findByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    view.rerender(center('user-2'))

    await screen.findByRole('button', { name: '通知，5 条未读' })
    stalePage.reject(new Error('old user page failed'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '通知，5 条未读' })).toBeInTheDocument()
  })
})

function renderCenter(userId = 'user-1') {
  return render(center(userId))
}

function center(userId: string) {
  return (
    <MemoryRouter initialEntries={['/tool/profiles']}>
      <NotificationCenterProvider userId={userId}>
        <NotificationBell iconOnly />
        <Routes>
          <Route path="*" element={<Location />} />
        </Routes>
      </NotificationCenterProvider>
    </MemoryRouter>
  )
}

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function page(unreadCount: number, nextCursor: string | null = null): UserNotificationPage {
  return {
    unread_count: unreadCount,
    next_cursor: nextCursor,
    as_of: '2026-07-30T00:01:00.000Z',
    notifications: [{
      id: 'notification-1',
      type: 'item_grant',
      title: '获得新道具',
      body: '优先计算券 ×1',
      action: { kind: 'inventory' },
      payload: {
        kind: 'item_grant',
        items: [{
          item_code: 'priority_compute_coupon',
          name: '优先计算券',
          icon_key: 'priority_compute_coupon',
          quantity: 1,
          expires_at: null,
        }],
      },
      read_at: null,
      created_at: '2026-07-30T00:00:00.000Z',
      updated_at: '2026-07-30T00:00:00.000Z',
    }],
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
