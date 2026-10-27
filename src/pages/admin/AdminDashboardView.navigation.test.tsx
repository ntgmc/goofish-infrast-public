// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '../../test/query-render'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../../lib/site-features'
import { readFileSync } from 'node:fs'
import AdminDashboardView from './AdminDashboardView'
import { createOperationsOverview } from '../../test/operations-overview-fixture'

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
    if (url === '/api/admin/usage-stats?view=todos') return { generated_at: new Date().toISOString(), feedback_unassigned: 2, feedback_reply: 3, risk_pending: null, abnormal_jobs: null }
    if (url.startsWith('/api/admin/usage-stats')) return createOperationsOverview()
    if (url.startsWith('/api/admin/cdk') || url.startsWith('/api/admin/users')) return {}
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
    api.json.mockImplementation((url: string) => url.includes('view=business') ? pending.promise : implementation(url))
    mount()
    const loading = await screen.findByRole('status', { name: '正在加载总览…' })
    const main = screen.getByRole('main')
    const header = document.querySelector('.tool-header')
    const navigation = screen.getByRole('navigation')
    expect(loading.closest('main')).toBe(main)
    expect(loading.querySelector('.page-loading-spinner')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '有多少人真正用起来了？', level: 2 })).not.toBeInTheDocument()
    await act(async () => { pending.reject(new Error('统计暂不可用')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('统计暂不可用')
    expect(await screen.findByRole('button', { name: '重新加载' })).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
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
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
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
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByRole('checkbox', { name: /用户注册/ })).toBe(registration)
    expect(registration).not.toBeChecked()
    await act(async () => { await router.navigate(1) })
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
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
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
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

  it('opens exact operational cohorts with partial coverage and a feedback todo without a manual search', async () => {
    const overview = createOperationsOverview()
    overview.current.complete = false
    overview.current.maa.complete = false
    overview.coverage.complete = false
    overview.coverage.unknown_outcomes = 1
    overview.coverage.maa_tracking_started_at = `${overview.current.from}T08:00:00Z`
    const account = { id: 'stopped-user', email: 'stopped@example.test', status: 'active', profile_count: 1, profile_access: [], created_at: overview.current.from,
      operations_progress: { stage: 'no_generation', failure_reason: 'optimizer_runtime_error', failure_at: overview.generated_at } }
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation(async (url: string) => {
      if (url === '/api/admin/session') return { user: { username: 'reviewer', capabilities: ['usage_view', 'user_view'] } }
      if (url.includes('view=business')) return overview
      if (url.startsWith('/api/admin/users?')) return { app_users: [account], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } }
      if (url.startsWith('/api/admin/feedback?')) return { items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } }
      return implementation(url)
    })
    const router = mount()
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
    for (const [label, rate] of [['新人首次排班率', '60%'], ['7 日再次排班率', '40%'], ['MAA 文件获取率', '80%']]) {
      expect(within(screen.getByRole('region', { name: label })).getByText(rate)).toBeInTheDocument()
    }
    expect(screen.getByText('64 / 80 份方案已获取（自文件获取记录开始）')).toBeInTheDocument()
    for (const [action, cohort] of [['查看未再次排班用户 →', 'reuse_missing'], ['查看未获取文件用户 →', 'maa_missing']]) {
      await user.click(screen.getByRole('link', { name: action }))
      expect(await screen.findByText(account.email)).toBeInTheDocument()
      expect(new URLSearchParams(router.state.location.search).get('cohort')).toBe(cohort)
      await user.click(await screen.findByRole('link', { name: '返回运营看板 →' }))
      await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
    }
    await user.click(screen.getByRole('link', { name: '查看添加账号后未排班用户 →' }))
    expect(await screen.findByText(account.email)).toBeInTheDocument()
    expect(screen.getByText(/最近失败：排班计算失败/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument()
    const target = new URLSearchParams(router.state.location.search)
    expect(Object.fromEntries(target)).toMatchObject({ cohort: 'activation_no_generation', from: overview.current.from, to: overview.current.to, observed_at: overview.generated_at })
    const request = api.json.mock.calls.find(([url]) => url.startsWith('/api/admin/users?') && url.includes('cohort=activation_no_generation'))![0]
    const sent = new URL(request, 'http://localhost').searchParams
    expect(Object.fromEntries(sent)).toMatchObject({ ...Object.fromEntries(target), search: '', page: '1', status: 'all' })
    await user.click(await screen.findByRole('link', { name: '返回运营看板 →' }))
    await user.click(await screen.findByRole('link', { name: /待回复反馈/ }))
    expect(await screen.findByRole('button', { name: copy.feedback.todos.reply })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.json.mock.calls.some(([url]) => url.startsWith('/api/admin/feedback?') && url.includes('todo=reply'))).toBe(true))
  })

  it('hides operational user lists and unauthorized todos from a risk viewer', async () => {
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation(async (url: string) => url === '/api/admin/session'
      ? { user: { username: 'viewer', capabilities: ['usage_view', 'risk_view'] } }
      : implementation(url))
    mount()
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
    expect(screen.queryByRole('link', { name: /查看.*用户/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /待回复反馈|待认领反馈|异常任务/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /待复核风险/ })).toHaveAttribute('href', '/admin/risk?status=pending')
  })

  it('passes the confirmed administrator to queue reads and cancels them when navigation leaves the monitor', async () => {
    const pending = deferred<unknown>()
    let signal: AbortSignal | undefined
    let queueReads = 0
    const queue = { snapshot_at: '2026-10-01T00:00:00Z',
      capacity: { queue_limit: 200, worker_concurrency: 3, worker_instances: 1, source: 'runtime_registry', heartbeat_interval_ms: 10_000, stale_after_ms: 30_000 },
      counts: { queued: 17, ready_queued: 0, oldest_ready_wait_ms: 0, running: 0, retry_waiting: 0, recent_failed: 0 }, queued_jobs: [], running_jobs: [], recent_jobs: [] }
    const implementation = api.json.getMockImplementation()!
    api.json.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url === '/api/admin/session') return { user: { username: 'operator', capabilities: ['usage_view', 'optimization_view'] } }
      if (url === '/api/admin/optimization?view=queue') {
        signal = options?.signal
        return ++queueReads === 1 ? pending.promise : queue
      }
      return implementation(url)
    })
    const router = mount('/admin/queue')
    await waitFor(() => expect(signal).toBeDefined())
    const firstSignal = signal
    await act(async () => { await router.navigate('/admin/overview') })
    await screen.findByRole('heading', { name: '有多少人真正用起来了？', level: 2 })
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => pending.resolve(queue))
    expect(screen.queryByText('17 / 200')).not.toBeInTheDocument()
    await act(async () => { await router.navigate('/admin/queue') })
    await screen.findByText('17 / 200')
    expect(queueReads).toBe(2)
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
