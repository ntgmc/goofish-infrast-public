// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../../lib/site-features'
import { readFileSync } from 'node:fs'
import AdminDashboardView from './AdminDashboardView'

const css = readFileSync('src/index.css', 'utf8')

const api = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('../../lib/admin-api-client', () => ({
  ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired',
  adminApiJson: api.json,
  adminApiVoid: vi.fn(),
  adminApiBlob: vi.fn(),
}))

let styles: HTMLStyleElement
beforeEach(() => {
  window.localStorage.clear()
  // Apply the production visibility rules so jsdom checks the accessible content.
  styles = document.createElement('style')
  styles.textContent = css.slice(css.indexOf('.admin-section[hidden]'), css.indexOf('@keyframes motion-content-enter'))
  document.head.append(styles)
  api.json.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/admin/session') return { user: { username: 'admin', capabilities: ['admin_manage', 'usage_view', 'user_view'] } }
    if (url === '/api/admin/feature-settings') return { settings: { ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 3 } }
    if (url === '/api/admin/invitation-settings') return { catalog: [], stats: null }
    if (url === '/api/admin/announcement') return { banner: null, announcements: [], revision: 1, stats: {} }
    if (url.startsWith('/api/admin/usage-stats') || url.startsWith('/api/admin/cdk') || url.startsWith('/api/admin/users')) return {}
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => {
  cleanup()
  styles.remove()
  vi.restoreAllMocks()
})

function mount(path = '/admin/overview') {
  const router = createMemoryRouter([{ path: '/admin/*', element: <AdminDashboardView /> }], { initialEntries: [path] })
  render(<MotionPreferenceProvider><RouterProvider router={router} /></MotionPreferenceProvider>)
  return router
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('admin page loading and navigation', () => {
  it('keeps the shell while overview data loads and restores content after a failed request', async () => {
    const pending = deferred<unknown>()
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation((url: string) => url.startsWith('/api/admin/usage-stats') ? pending.promise : implementation(url))
    mount()
    const loading = await screen.findByRole('status', { name: '正在加载总览…' })
    const main = screen.getByRole('main')
    const header = document.querySelector('.tool-header')
    const navigation = screen.getByRole('navigation')
    expect(loading.closest('main')).toBe(main)
    expect(loading.querySelector('.page-loading-spinner')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '运营概览', level: 2 })).not.toBeInTheDocument()
    await act(async () => { pending.reject(new Error('统计暂不可用')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('统计暂不可用')
    expect(await screen.findByRole('heading', { name: '运营概览', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '正在加载总览…' })).not.toBeInTheDocument()
    expect(document.querySelector('.tool-header')).toBe(header)
    expect(screen.getByRole('navigation')).toBe(navigation)
  })

  it('closes a portalled picker when history leaves its section and preserves the settings draft', async () => {
    const router = mount('/admin/invitations')
    const user = userEvent.setup()
    const limit = await screen.findByRole('spinbutton', { name: /每日获奖邀请人数上限/ })
    await user.clear(limit)
    await user.type(limit, '25')
    await user.click(screen.getAllByRole('button', { name: '添加道具' })[0])
    await screen.findByRole('dialog')
    await act(async () => { await router.navigate('/admin/overview') })
    await screen.findByRole('heading', { name: '运营概览', level: 2 })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByRole('spinbutton', { name: /每日获奖邀请人数上限/ })).toHaveValue(25)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps a settings draft and the same shell through loading, rapid navigation, and history', async () => {
    const pending = deferred<unknown>()
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation((url: string) => url === '/api/admin/feature-settings' ? pending.promise : implementation(url))
    const router = mount()
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '运营概览', level: 2 })
    const header = document.querySelector('.tool-header')
    const navigation = screen.getByRole('navigation')
    await user.click(screen.getByRole('link', { name: '功能开关' }))
    expect(await screen.findByRole('status', { name: '正在加载功能开关…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('checkbox', { name: /用户注册/ })).not.toBeInTheDocument()
    expect(document.querySelector('.tool-header')).toBe(header)
    await act(async () => { pending.resolve({ settings: { ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 3 } }) })
    const registration = await screen.findByRole('checkbox', { name: /用户注册/ })
    await user.click(registration)
    expect(registration).not.toBeChecked()
    await user.click(screen.getByRole('link', { name: '总览' }))
    await screen.findByRole('heading', { name: '运营概览', level: 2 })
    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByRole('checkbox', { name: /用户注册/ })).toBe(registration)
    expect(registration).not.toBeChecked()
    await act(async () => { await router.navigate(1) })
    await screen.findByRole('heading', { name: '运营概览', level: 2 })
    await act(async () => {
      await router.navigate('/admin/features')
      await router.navigate('/admin/overview')
      await router.navigate('/admin/features')
    })
    expect(await screen.findByRole('checkbox', { name: /用户注册/ })).not.toBeChecked()
    expect(document.querySelector('.tool-header')).toBe(header)
    expect(screen.getByRole('navigation')).toBe(navigation)
    expect(api.json.mock.calls.filter(([url]) => url === '/api/admin/feature-settings')).toHaveLength(1)
  })

  it('loads only the user domain and hides management operations for a reviewer', async () => {
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation(async (url: string) => url === '/api/admin/session'
      ? { user: { username: 'reviewer', capabilities: ['risk_view', 'risk_review', 'usage_view', 'user_view'] } }
      : implementation(url))
    const router = mount('/admin/users')
    await screen.findByRole('heading', { name: '注册用户' })
    expect(screen.queryByRole('button', { name: '重置密码' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '重置用户密码' })).not.toBeInTheDocument()
    expect(api.json.mock.calls.some(([url]) => /usage-stats|announcement|\/cdk|risk-settings/.test(url))).toBe(false)
    await act(async () => { await router.navigate('/admin/features') })
    await screen.findByRole('heading', { name: '运营概览', level: 2 })
    expect(api.json.mock.calls.some(([url]) => url === '/api/admin/feature-settings')).toBe(false)
  })

  it('refreshes the selected user detail without loading another user list or domain', async () => {
    const account = { id: 'user-1', email: 'user@example.test', status: 'active', profile_count: 0, profile_access: [], created_at: '2026-10-01T00:00:00.000Z' }
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation(async (url: string) => {
      if (url === '/api/admin/session') return { user: { username: 'admin', capabilities: ['user_view', 'sensitive_data_view', 'user_manage'] } }
      if (url.startsWith('/api/admin/users?user_id=')) return { detail: { user: account, profiles: [], personal_use_declarations: [] } }
      if (url.startsWith('/api/admin/users?')) return { app_users: [account] }
      return implementation(url)
    })
    mount('/admin/users')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '详情' }))
    await screen.findByRole('heading', { name: account.email })
    api.json.mockClear()
    await user.click(screen.getByRole('button', { name: '刷新当前页' }))
    await waitFor(() => expect(api.json).toHaveBeenCalledTimes(1))
    expect(api.json.mock.calls[0][0]).toBe('/api/admin/users?user_id=user-1&profile_page=1&profile_page_size=100')
  })

  it('aborts a user request when leaving the page and ignores its late result', async () => {
    const pending = deferred<unknown>()
    let signal: AbortSignal | undefined
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation((url: string, options?: { signal?: AbortSignal }) => {
      if (url.startsWith('/api/admin/users?')) { signal = options?.signal; return pending.promise }
      return implementation(url)
    })
    const router = mount('/admin/users')
    await screen.findByRole('status', { name: '正在加载用户维护…' })
    await act(async () => { await router.navigate('/admin/features') })
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ app_users: [{ email: 'late@example.test' }] }) })
    await screen.findByRole('checkbox', { name: /用户注册/ })
    expect(screen.queryByText('late@example.test')).not.toBeInTheDocument()
  })
})
