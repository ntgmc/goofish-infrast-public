// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AuthUser, UserGameAccount } from '../lib/types'
import type { InventoryResponse } from '../lib/inventory-contracts'
import { cloneDefaultPublicContentSettings } from '../lib/public-content'
import { readToolBehaviorEvents, recordToolBehavior } from '../lib/tool-behavior-observation'
import { tourStorageKey } from '../components/GuidedTour'
import { useSiteFeatures } from '../lib/site-feature-context'
import { DEFAULT_SITE_FEATURES } from '../lib/site-features'
import ToolPage from './ToolPage'
import { copy } from '../copy'

vi.mock('../lib/site-feature-context', () => ({ useSiteFeatures: vi.fn() }))

const { apiJson, sessionState, toolsSectionImport } = vi.hoisted(() => {
  let resolveToolsSection!: () => void
  return {
    apiJson: vi.fn(),
    sessionState: { current: null as Record<string, unknown> | null },
    toolsSectionImport: {
      pending: new Promise<void>((resolve) => { resolveToolsSection = resolve }),
      resolve: () => resolveToolsSection(),
    },
  }
})

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api-client')>(),
  apiJson,
}))

vi.mock('./tool/useToolSession', () => ({
  useToolSession: () => sessionState.current,
}))

vi.mock('./OptimizePage', () => ({
  default: () => <main tabIndex={-1} data-route-focus>优化页</main>,
}))

vi.mock('./tool/dashboard/ToolsSection', async () => {
  await toolsSectionImport.pending
  return { default: () => <section>工具内容</section> }
})

beforeEach(() => {
  vi.mocked(useSiteFeatures).mockReturnValue({
    status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: vi.fn(),
  })
  window.localStorage.clear()
  window.localStorage.setItem(tourStorageKey('dashboard-overview', 1), 'done')
  window.localStorage.setItem(tourStorageKey('workspace-setup', 1), 'done')
  apiJson.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/site/public-content') return cloneDefaultPublicContentSettings()
    if (url === '/api/user/qqbot') return { available: false, binding: null }
    throw new Error(`Unexpected request: ${url}`)
  })
  sessionState.current = createSession()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ToolPage route guards', () => {
  it.each(['site', 'login', 'error'] as const)('keeps settings safety operations available when %s is unavailable', async (unavailable) => {
    vi.mocked(useSiteFeatures).mockReturnValue({
      status: unavailable === 'error' ? 'error' : 'ready',
      features: { ...DEFAULT_SITE_FEATURES, ...(unavailable === 'error' ? {} : { [unavailable]: false }) },
      updatedAt: null, retry: vi.fn(),
    })
    const router = renderToolRoute('/tool/settings')
    expect(screen.getByRole('button', { name: '安全退出' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修改密码' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/settings')
    await screen.findByText('QQ 通知服务尚未开放，开放后即可绑定并接收提醒。')
  })

  it('updates QQ notifications from the account settings entry', async () => {
    const user = userEvent.setup()
    let enabled = false
    apiJson.mockImplementation(async (url: string, options?: { method?: string; json?: { notifications_enabled: boolean } }) => {
      if (url !== '/api/user/qqbot') throw new Error(`Unexpected request: ${url}`)
      if (options?.method === 'PATCH') enabled = options.json!.notifications_enabled
      return { available: true, binding: { binding_id: 'binding-1', qq_number: '123456', notifications_enabled: enabled, bound_at: '2026-10-04T00:00:00Z' } }
    })
    renderToolRoute('/tool/settings')
    const notificationSetting = await screen.findByRole('checkbox', { name: '接收排班完成通知' })
    expect(notificationSetting).not.toBeChecked()
    await user.click(notificationSetting)
    await waitFor(() => expect(notificationSetting).toBeChecked())
    expect(apiJson).toHaveBeenCalledWith('/api/user/qqbot', { method: 'PATCH', json: { notifications_enabled: true } })
  })

  it.each(['/tool/balance', '/tool/commercial'])('returns a retired entry to profiles: %s', async (path) => {
    const router = renderToolRoute(path)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))
    expect(screen.queryByText(/积分|商用账户/)).not.toBeInTheDocument()
  })

  it.each(['metered_personal', 'metered_commercial'] as const)('prevents a retired %s profile from entering the scheduler', async (kind) => {
    const profile = createProfile(kind)
    const router = renderToolRoute('/tool/optimize/overview', {
      activeProfile: profile, activeCdkProfile: profile, cdkProfiles: [profile],
      license: { operators: [], config: {}, order_hash: 'order' },
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))
    expect(screen.queryByText('优化页')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开账号并准备数据' })).not.toBeInTheDocument()
  })

  it.each([true, false])('opens the expiring profile export page only after saving the current draft: %s', async (saved) => {
    const user = userEvent.setup()
    const activeProfile = createProfile()
    const expiringProfile = {
      ...createProfile(),
      id: 'expiring-profile',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }
    const flushConfigSave = vi.fn().mockResolvedValue(saved)
    const router = renderToolRoute('/tool/setup/config', {
      activeProfile,
      activeCdkProfile: activeProfile,
      cdkProfiles: [activeProfile, expiringProfile],
      license: { operators: [], config: {}, order_hash: 'order' },
      flushConfigSave,
    })
    await user.click(await screen.findByRole('button', { name: '前往保存与导出' }))
    expect(flushConfigSave).toHaveBeenCalledOnce()
    await waitFor(() => expect(router.state.location.pathname).toBe(saved ? '/tool/optimize/plans' : '/tool/setup/config'))
    expect(router.state.location.search).toBe(saved ? '?profile_id=expiring-profile' : '')
  })

  it.each([true, false])('returns to profiles only when configuration saving succeeds: %s', async (saved) => {
    const user = userEvent.setup()
    const flushConfigSave = vi.fn().mockResolvedValue(saved)
    const router = renderToolRoute('/tool/setup/config', { activeProfile: createProfile(), flushConfigSave })
    await user.click(screen.getByRole('button', { name: '返回账号列表' }))
    expect(flushConfigSave).toHaveBeenCalledOnce()
    await waitFor(() => expect(router.state.location.pathname).toBe(saved ? '/tool/profiles' : '/tool/setup/config'))
  })

  it('shows the announcement banner after the /tool entry redirects to the dashboard', async () => {
    const router = renderToolRoute('/tool', {
      banner: {
        id: 'banner-1',
        kind: 'banner',
        title: '维护公告',
        body: '今晚进行例行维护。',
        active: true,
        updated_at: '2026-07-21T00:00:00.000Z',
      },
    })

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))
    const banner = await screen.findByRole('region', { name: '站内横幅' })
    expect(banner).toHaveTextContent('维护公告')
    expect(screen.getByText('今晚进行例行维护。')).toBeInTheDocument()
  })

  it('keeps the opened profile in the URL so a refresh can restore it', async () => {
    const user = userEvent.setup()
    const firstProfile = createProfile()
    const secondProfile = { ...createProfile(), id: 'profile-2', display_name: '第二个档案' }
    const refreshProfileWorkspace = vi.fn().mockResolvedValue(undefined)
    const router = renderToolRoute('/tool/profiles', {
      activeProfile: firstProfile,
      activeCdkProfile: firstProfile,
      cdkProfiles: [firstProfile, secondProfile],
      refreshProfileWorkspace,
    })

    await user.click((await screen.findAllByRole('button', { name: '打开账号并准备数据' }))[1])

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    expect(router.state.location.search).toBe('?profile_id=profile-2')
    expect(refreshProfileWorkspace).toHaveBeenCalledWith(secondProfile)
  })

  it('preserves the navigation and background while the next section code loads', async () => {
    const user = userEvent.setup()
    const router = renderToolRoute('/tool/profiles')
    await screen.findByRole('heading', { name: '还没有添加游戏账号' })
    const shell = document.querySelector('.tool-shell')
    const navigation = screen.getByRole('navigation', { name: copy.common.pages_tool_AccountDashboard_008 })

    await user.click(screen.getAllByRole('button', { name: '工具' })[0])

    expect(router.state.location.pathname).toBe('/tool/tools')
    const loading = await screen.findByRole('status', { name: copy.common.pages_tool_AccountDashboard_015 })
    expect(loading).toHaveClass('tool-section-loader')
    expect(loading.querySelector('.page-loading-spinner')).toBeInTheDocument()
    expect(document.querySelector('.tool-shell')).toBe(shell)
    expect(screen.getByRole('navigation', { name: copy.common.pages_tool_AccountDashboard_008 })).toBe(navigation)
    expect(screen.getAllByRole('button', { name: '工具' })[0]).toHaveAttribute('aria-current', 'page')

    toolsSectionImport.resolve()
    expect(await screen.findByText('工具内容')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.common.pages_tool_AccountDashboard_015 })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '还没有添加游戏账号' })).not.toBeInTheDocument()
  })

  it.each([
    ['inventory', '/api/user/inventory', copy.inventory.nav, copy.inventory.loading],
    ['invitations', '/api/user/invitations', copy.common.pages_tool_AccountDashboard_004, copy.dashboard.pages_tool_dashboard_InvitationsSection_005],
    ['announcements', '/api/user/announcements', copy.common.pages_tool_AccountDashboard_005, copy.dashboard.pages_tool_dashboard_AnnouncementsSection_006],
  ])('keeps the main loading region until %s data succeeds or fails', async (section, endpoint, navLabel, loadingLabel) => {
    let rejectLoad!: (error: Error) => void
    const pending = new Promise<never>((_, reject) => { rejectLoad = reject })
    apiJson.mockImplementation(async (url: string) => url === endpoint ? pending : { tasks: [], notifications: [], unread_count: 0 })
    const user = userEvent.setup()
    const router = renderToolRoute('/tool/profiles')
    await screen.findByRole('heading', { name: '还没有添加游戏账号' })
    const main = screen.getByRole('main')
    const header = document.querySelector('.tool-header')

    await user.click(screen.getAllByRole('button', { name: navLabel })[0])
    const loading = await screen.findByRole('status', { name: loadingLabel })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading).toHaveClass('tool-section-loader')
    expect(loading.closest('main')).toBe(main)
    expect(document.querySelector('.tool-header')).toBe(header)
    expect(router.state.location.pathname).toBe(`/tool/${section}`)

    await act(async () => { rejectLoad(new Error('Load failed')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Load failed')
    expect(screen.queryByRole('status', { name: loadingLabel })).not.toBeInTheDocument()
    expect(document.querySelector('.tool-header')).toBe(header)
  })

  it('keeps a requested deep link while the user is signed out', async () => {
    const router = renderToolRoute('/tool/setup/config', { authStatus: 'anonymous', user: null })

    expect(await screen.findByRole('heading', { name: 'MAA 基建排班工作台' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/setup/config')
  })

  it('shows an authentication retry page instead of the login form when restoration fails', async () => {
    const retryAuth = vi.fn()
    const user = userEvent.setup()
    renderToolRoute('/tool/profiles', { authStatus: 'error', retryAuth })

    expect(await screen.findByRole('heading', { name: '暂时无法确认登录状态' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'MAA 基建排班工作台' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新确认登录状态' }))
    expect(retryAuth).toHaveBeenCalledOnce()
  })

  it('replaces protected routes with profiles when no schedulable profile is active', async () => {
    const router = renderToolRoute('/tool/optimize/result')

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))
    expect(screen.getByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
  })

  it('routes an incomplete workspace to the first missing setup page', async () => {
    const profile = createProfile()
    const withoutOperators = renderToolRoute('/tool/optimize/result', {
      activeProfile: profile,
      activeCdkProfile: profile,
      cdkProfiles: [profile],
    })
    await waitFor(() => expect(withoutOperators.state.location.pathname).toBe('/tool/setup/operators'))
    cleanup()

    sessionState.current = createSession({
      activeProfile: profile,
      activeCdkProfile: profile,
      cdkProfiles: [profile],
      workspace: { profile_id: profile.id, operators: [], config: null },
    })
    const withoutConfig = renderCurrentSession('/tool/optimize/result')
    await waitFor(() => expect(withoutConfig.state.location.pathname).toBe('/tool/setup/config'))
  })

  it('loads public content for workspace setup without loading it on dashboard routes', async () => {
    renderToolRoute('/tool/profiles')
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(apiJson).not.toHaveBeenCalledWith('/api/site/public-content', expect.any(Object))
    cleanup()
    apiJson.mockClear()

    const profile = createProfile()
    renderToolRoute('/tool/setup/cdk', {
      activeProfile: profile,
      activeCdkProfile: profile,
      cdkProfiles: [profile],
    })
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/site/public-content', expect.any(Object)))
  })

  it('normalizes invalid optimize paths and defers lab entitlement checks until inventory loads', async () => {
    const profile = createProfile()
    const session = {
      activeProfile: profile,
      activeCdkProfile: profile,
      cdkProfiles: [profile],
      license: { operators: [], config: {}, order_hash: 'order' },
    }
    const invalid = renderToolRoute('/tool/optimize/unknown', session)
    await waitFor(() => expect(invalid.state.location.pathname).toBe('/tool/optimize/overview'))
    cleanup()

    sessionState.current = createSession({ ...session, activeProfile: createProfile('free_preview') })
    const unavailableLab = renderCurrentSession('/tool/optimize/lab')
    await waitFor(() => expect(unavailableLab.state.location.pathname).toBe('/tool/optimize/lab'))
    expect(await screen.findByText('优化页')).toBeInTheDocument()
  })

  it.each([
    ['dashboard', '/tool/profiles'],
    ['setup', '/tool/setup/operators'],
    ['optimize', '/tool/optimize/overview'],
  ])('opens the shared upgrade prompt from the %s route and navigates to inventory', async (routeName, path) => {
    const user = userEvent.setup()
    const userId = `upgrade-${routeName}`
    const profile = createBoundFreePreviewProfile(userId, `profile-${routeName}`)
    apiJson.mockImplementation(async (url: string) => {
      if (url === '/api/site/public-content') return cloneDefaultPublicContentSettings()
      if (url === '/api/user/inventory') return createUpgradeInventory()
      throw new Error(`Unexpected request: ${url}`)
    })
    const router = renderToolRoute(path, {
      user: { id: userId, email: `${userId}@example.com` } as AuthUser,
      activeProfile: profile,
      activeCdkProfile: profile,
      cdkProfiles: [profile],
      workspace: { profile_id: profile.id, operators: [], config: {} },
      license: { operators: [], config: {}, order_hash: 'order' },
    })

    await user.click(await screen.findByRole('button', { name: '前往背包查看' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/inventory'))
    expect(screen.queryByRole('dialog', { name: '背包中有档案升级道具' })).not.toBeInTheDocument()
  })
})

describe('single game account workspace entry', () => {
  const storageKey = 'maatool:workspace-entry:v1:user-1'
  const observationKey = 'maatool:workspace-entry-observation:v1:user-1'
  const day = 24 * 60 * 60 * 1000

  function accountSession(profiles: UserGameAccount[]) {
    return {
      activeProfile: profiles[0], activeCdkProfile: profiles[0], cdkProfiles: profiles,
      refreshProfileWorkspace: vi.fn().mockResolvedValue(undefined),
    }
  }

  function enableStored(target: string) {
    window.localStorage.setItem(storageKey, JSON.stringify({ target, remindAfter: 0 }))
  }

  function observeStored(target: string, userId = 'user-1', opens?: number[]) {
    const now = Date.now()
    window.localStorage.setItem(`maatool:workspace-entry-observation:v1:${userId}`, JSON.stringify({
      target,
      opens: opens ?? [now - 4 * day, now - 3 * day, now - 2 * day, now - day, now - day + 60 * 60 * 1000],
    }))
  }

  it('does not suggest skipping the dashboard merely because an account is eligible', async () => {
    const router = renderToolRoute('/tool/profiles', accountSession([createProfile()]))
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(window.localStorage.getItem(observationKey)).toBeNull()
  })

  it('observes successful quick manual opens across several days before suggesting the shortcut', async () => {
    const user = userEvent.setup()
    const start = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const session = accountSession([createProfile()])
    for (const elapsed of [0, 45 * 60 * 1000, day, day + 45 * 60 * 1000, 2 * day]) {
      clock.mockReturnValue(start + elapsed)
      const router = renderToolRoute('/tool/profiles', session)
      expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: '打开账号并准备数据' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
      cleanup()
    }
    expect(JSON.parse(window.localStorage.getItem(observationKey)!).opens).toHaveLength(5)
    clock.mockReturnValue(start + 2 * day + 60 * 60 * 1000)
    renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    cleanup()

    clock.mockReturnValue(start + 3 * day)
    const router = renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('button', { name: '启用并进入工作区' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')
  })

  it.each(['one day', 'too few opens', 'stale history', 'different game account', 'invalid history'])('does not suggest a shortcut for %s', async (reason) => {
    const now = Date.now()
    const opens = reason === 'one day' ? [1, 2, 3, 4, 5].map((hour) => now - 4 * day + hour * 60 * 60 * 1000)
      : reason === 'too few opens' ? [now - 4 * day, now - 2 * day, now - day]
      : reason === 'stale history' ? [20, 19, 18, 17, 16].map((days) => now - days * day)
      : reason === 'invalid history' ? ['invalid']
      : undefined
    if (reason === 'invalid history') {
      window.localStorage.setItem(observationKey, JSON.stringify({ target: 'profile:profile-1', opens }))
    } else {
      observeStored(reason === 'different game account' ? 'uid:other' : 'profile:profile-1', 'user-1', opens as number[] | undefined)
    }
    renderToolRoute('/tool/profiles', accountSession([createProfile()]))
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
  })

  it('ignores rapid repeated visits and time spent managing the dashboard', async () => {
    const user = userEvent.setup()
    const start = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const session = accountSession([createProfile()])
    for (const elapsed of [0, 1000]) {
      clock.mockReturnValue(start + elapsed)
      const router = renderToolRoute('/tool/profiles', session)
      await user.click(await screen.findByRole('button', { name: '打开账号并准备数据' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
      cleanup()
    }
    expect(JSON.parse(window.localStorage.getItem(observationKey)!).opens).toHaveLength(1)

    clock.mockReturnValue(start + day)
    const router = renderToolRoute('/tool/profiles', session)
    await screen.findByRole('button', { name: '打开账号并准备数据' })
    clock.mockReturnValue(start + day + 61 * 1000)
    await user.click(screen.getByRole('button', { name: '打开账号并准备数据' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    expect(JSON.parse(window.localStorage.getItem(observationKey)!).opens).toHaveLength(1)
  })

  it('does not count failed opens or direct workspace visits', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = accountSession([createProfile()])
    session.refreshProfileWorkspace.mockRejectedValue(new Error('Workspace unavailable'))
    const router = renderToolRoute('/tool/profiles', session)
    await user.click(await screen.findByRole('button', { name: '打开账号并准备数据' }))
    await waitFor(() => expect(console.error).toHaveBeenCalledOnce())
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(window.localStorage.getItem(observationKey)).toBeNull()
    cleanup()
    renderToolRoute('/tool/setup/operators?profile_id=profile-1', session)
    expect(await screen.findByRole('button', { name: '返回账号列表' })).toBeInTheDocument()
    expect(window.localStorage.getItem(observationKey)).toBeNull()
  })

  it('asks before enabling, restores the default on entry, and allows returning to the dashboard', async () => {
    const user = userEvent.setup()
    const session = accountSession([createProfile()])
    observeStored('profile:profile-1')
    const router = renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('heading', { name: '下次直接进入这个游戏账号？' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(readToolBehaviorEvents('user-1').filter((event) => event.name === 'entry_prompt_shown')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '启用并进入工作区' }))
    expect(readToolBehaviorEvents('user-1').some((event) => event.name === 'entry_enable')).toBe(true)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    expect(router.state.location.search).toBe('?profile_id=profile-1')
    await user.click(await screen.findByRole('button', { name: '返回账号列表' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))
    expect(screen.queryByRole('heading', { name: '下次直接进入这个游戏账号？' })).not.toBeInTheDocument()

    cleanup()
    const reloaded = renderToolRoute('/tool', session)
    await waitFor(() => expect(reloaded.state.location.pathname).toBe('/tool/setup/operators'))
    expect(reloaded.state.location.search).toBe('?profile_id=profile-1')
  })

  it('treats a free and paid profile bound to the same UID as one game account and opens the paid profile', async () => {
    const user = userEvent.setup()
    const free = createBoundFreePreviewProfile('user-1', 'free')
    const paid = { ...createProfile(), skland_binding: free.skland_binding }
    observeStored('uid:skland-free')
    const router = renderToolRoute('/tool/profiles', accountSession([free, paid]))
    await user.click(await screen.findByRole('button', { name: '启用并进入工作区' }))
    await waitFor(() => expect(router.state.location.search).toBe('?profile_id=profile-1'))
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual({ target: 'uid:skland-free', remindAfter: 0 })
  })

  it('falls back to the free profile when the paid profile for the same UID has expired', async () => {
    const free = createBoundFreePreviewProfile('user-1', 'free')
    const paid = { ...createProfile(), skland_binding: free.skland_binding, expires_at: '2000-01-01T00:00:00.000Z' }
    enableStored('uid:skland-free')
    const router = renderToolRoute('/tool/profiles', accountSession([paid, free]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    expect(router.state.location.search).toBe('?profile_id=free')
  })

  it.each(['different UID', 'unbound profile', 'unavailable profile', 'expired profile'])('pauses automatic entry for %s', async (reason) => {
    const first = { ...createProfile(), skland_binding: createBoundFreePreviewProfile('user-1', 'first').skland_binding }
    const second = createBoundFreePreviewProfile('user-1', 'second')
    const profiles = reason === 'different UID' ? [first, second]
      : reason === 'unbound profile' ? [first, { ...second, skland_binding: null }]
      : reason === 'unavailable profile' ? [{ ...first, status: 'frozen' as const }]
      : [{ ...first, expires_at: '2000-01-01T00:00:00.000Z' }]
    enableStored('uid:skland-first')
    const router = renderToolRoute('/tool/profiles', accountSession(profiles))
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
  })

  it.each(['/tool/settings', '/tool/profiles?profile_id=profile-1', '/tool/profiles?recovery=1'])('preserves explicit access to %s', async (path) => {
    enableStored('profile:profile-1')
    const router = renderToolRoute(path, accountSession([createProfile()]))
    expect(await screen.findByRole('heading', { name: path.includes('settings') ? '默认进入方式' : '游戏账号' })).toBeInTheDocument()
    expect(router.state.location.pathname + router.state.location.search).toBe(path)
  })

  it('keeps reminders until dismissed and resumes them only after seven days', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const session = accountSession([createProfile()])
    observeStored('profile:profile-1')
    renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('button', { name: '启用并进入工作区' })).toBeInTheDocument()
    cleanup()
    renderToolRoute('/tool/profiles', session)
    await user.click((await screen.findAllByRole('button', { name: '7 天内不再提醒' }))[0])
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    cleanup()

    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 - 1)
    renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    cleanup()

    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000)
    renderToolRoute('/tool/profiles', session)
    await user.click(await screen.findByRole('button', { name: '不再提示' }))
    cleanup()
    clock.mockReturnValue(now + 30 * 24 * 60 * 60 * 1000)
    renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
  })

  it('allows enabling and disabling the preference in account settings', async () => {
    const user = userEvent.setup()
    const session = accountSession([createProfile()])
    renderToolRoute('/tool/settings', session)
    const setting = await screen.findByRole('checkbox', { name: /只有一个游戏账号时/ })
    await user.click(setting)
    expect(setting).toBeChecked()
    cleanup()
    const router = renderToolRoute('/tool/profiles', session)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    await router.navigate('/tool/settings')
    await user.click(await screen.findByRole('checkbox', { name: /只有一个游戏账号时/ }))
    cleanup()
    const disabled = renderToolRoute('/tool/profiles', session)
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(disabled.state.location.pathname).toBe('/tool/profiles')
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
  })

  it('keeps observation controls collapsed and can clear the current user operation log', async () => {
    const user = userEvent.setup()
    renderToolRoute('/tool/settings', accountSession([createProfile()]))
    const summary = await screen.findByText('操作习惯记录')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    recordToolBehavior({ name: 'config_save', profile: 'profile-1' })
    expect(readToolBehaviorEvents('user-1')).toHaveLength(1)
    await user.click(summary)
    await user.click(screen.getByRole('button', { name: '清空操作记录' }))
    expect(readToolBehaviorEvents('user-1')).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('已清空当前账号的操作记录')
  })

  it('keeps observations separate for different users and observes a different game account afresh', async () => {
    enableStored('uid:old-account')
    observeStored('uid:old-account')
    const router = renderToolRoute('/tool/profiles', accountSession([createProfile()]))
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')
    cleanup()

    enableStored('profile:profile-1')
    renderToolRoute('/tool/profiles', {
      ...accountSession([createProfile()]),
      user: { id: 'user-2', email: 'other@example.com' } as AuthUser,
    })
    expect(await screen.findByRole('heading', { name: '游戏账号' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用并进入工作区' })).not.toBeInTheDocument()
    cleanup()
    observeStored('profile:profile-1', 'user-2')
    renderToolRoute('/tool/profiles', {
      ...accountSession([createProfile()]),
      user: { id: 'user-2', email: 'other@example.com' } as AuthUser,
    })
    expect(await screen.findByRole('button', { name: '启用并进入工作区' })).toBeInTheDocument()
  })

  it('does not enable or navigate when browser storage rejects the preference', async () => {
    const user = userEvent.setup()
    observeStored('profile:profile-1')
    const router = renderToolRoute('/tool/profiles', accountSession([createProfile()]))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
    await user.click(await screen.findByRole('button', { name: '启用并进入工作区' }))
    expect(screen.getByRole('alert')).toHaveTextContent('无法在当前浏览器保存设置')
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(screen.getByRole('button', { name: '启用并进入工作区' })).toBeInTheDocument()
  })
})

function renderToolRoute(path: string, overrides: Record<string, unknown> = {}) {
  sessionState.current = createSession(overrides)
  return renderCurrentSession(path)
}

function renderCurrentSession(path: string) {
  const router = createMemoryRouter([
    { path: '/tool/*', element: <ToolPage /> },
  ], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    authStatus: 'authenticated',
    authError: null,
    retryAuth: vi.fn(),
    authLoading: false,
    user: { id: 'user-1', email: 'test@example.com' } as AuthUser,
    profiles: [],
    activeProfile: null,
    activeCdkProfile: null,
    cdkProfiles: [],
    workspace: null,
    license: null,
    setLicense: vi.fn(),
    eliteOverrides: {},
    configOverride: null,
    setConfigOverride: vi.fn(),
    configSyncStatus: 'idle',
    retryConfigSave: vi.fn(),
    flushConfigSave: vi.fn().mockResolvedValue(true),
    banner: null,
    popups: [],
    announcementUnreadCount: 0,
    openingProfileId: null,
    workspaceLoadError: null,
    applyAuthPayload: vi.fn(),
    refreshProfileWorkspace: vi.fn(),
    persistWorkspacePatch: vi.fn(),
    handleLogout: vi.fn(),
    ...overrides,
  }
}

function createProfile(kind: UserGameAccount['kind'] = 'cdk'): UserGameAccount {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    kind,
    permission: 'advanced',
    status: 'active',
    cdk_order_hash: 'order',
    display_name: '测试档案',
    note: '',
    skland_binding: null,
    operator_count: 0,
    updated_at: null,
    created_at: '2026-07-11T00:00:00.000Z',
  }
}

function createBoundFreePreviewProfile(userId: string, profileId: string): UserGameAccount {
  return {
    ...createProfile('free_preview'),
    id: profileId,
    user_id: userId,
    permission: 'recommended',
    cdk_order_hash: null,
    skland_binding: {
      uid: `skland-${profileId}`,
      nickname: '测试用户',
      channel_name: '官服',
      bound_at: '2026-08-01T00:00:00.000Z',
      last_imported_at: null,
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    },
  }
}

function createUpgradeInventory(): InventoryResponse {
  return {
    stacks: [{
      stack_id: 'lifetime-profile-voucher',
      item: {
        code: 'lifetime_profile_voucher',
        kind: 'license_voucher',
        effect_code: 'bind_lifetime_profile',
        name: '终身版兑换 CDK',
        description: '升级档案',
        icon_key: 'lifetime_profile_voucher',
        system_owned: true,
        issuance_enabled: true,
        created_at: null,
        updated_at: null,
      },
      gift_pack_version_id: null,
      quantity: 1,
      permanent: 1,
      next_expiry_at: null,
      expiry_buckets: [{ quantity: 1, expires_at: null }],
      actions: ['bind'],
    }],
    capacities: [],
    recent_events: [],
  }
}
