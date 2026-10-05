// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSafetyPage from './AccountSafetyPage'
import { useSiteFeatures } from '../lib/site-feature-context'
import { DEFAULT_SITE_FEATURES } from '../lib/site-features'

vi.mock('../lib/site-feature-context', () => ({ useSiteFeatures: vi.fn() }))

beforeEach(() => {
  vi.mocked(useSiteFeatures).mockReturnValue({
    status: 'ready', features: { ...DEFAULT_SITE_FEATURES, site: false, login: false }, updatedAt: null, retry: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AccountSafetyPage lifecycle controls', () => {
  it('shows the scheduled deletion and queued cancellation email before leaving', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => Promise.resolve(new Response(JSON.stringify(url === '/api/user/qqbot' ? { available: false, binding: null } : {
      ok: true,
      scheduled_for: '2026-08-07T00:00:00.000Z',
      cancellation_email: 'queued',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }))))
    renderPage()

    await user.click(screen.getByText('注销账号'))
    const email = screen.getByLabelText('确认邮箱')
    const password = screen.getByLabelText('当前密码')
    expect(email).toHaveAttribute('maxlength', '254')
    expect(password).toHaveAttribute('maxlength', '128')
    await user.type(email, 'user@example.test')
    await user.type(password, 'password')
    await user.click(screen.getByRole('button', { name: '申请注销账号' }))

    expect(await screen.findByText('注销申请已受理')).toBeInTheDocument()
    expect(screen.getByText(/撤销邮件正在发送/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '申请注销账号' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安全退出' })).toBeDisabled()
  })

  it('replaces the legacy entry with settings when the service is open', async () => {
    vi.mocked(useSiteFeatures).mockReturnValue({
      status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: vi.fn(),
    })
    const router = renderPage()
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/settings'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByRole('button', { name: '申请注销账号' })).not.toBeInTheDocument()
  })

  it.each(['site', 'login', 'error'] as const)('keeps safety controls available when %s is unavailable', async (unavailable) => {
    vi.mocked(useSiteFeatures).mockReturnValue({
      status: unavailable === 'error' ? 'error' : 'ready',
      features: { ...DEFAULT_SITE_FEATURES, ...(unavailable === 'error' ? {} : { [unavailable]: false }) },
      updatedAt: null, retry: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false, binding: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    const router = renderPage()
    expect(screen.getByRole('button', { name: '安全退出' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修改密码' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account-safety')
    await screen.findByText('QQ 通知服务尚未开放，开放后即可绑定并接收提醒。')
  })
})

function renderPage() {
  const router = createMemoryRouter([
    { path: '/account-safety', element: <AccountSafetyPage /> },
    { path: '/tool/settings', element: <main>Settings destination</main> },
  ], { initialEntries: ['/account-safety'] })
  render(<RouterProvider router={router} />)
  return router
}
