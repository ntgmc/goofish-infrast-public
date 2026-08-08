// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AuthUser, UserGameAccount } from '../lib/types'
import type { InventoryResponse } from '../lib/inventory-contracts'
import { cloneDefaultPublicContentSettings } from '../lib/public-content'
import { tourStorageKey } from '../components/GuidedTour'
import ToolPage from './ToolPage'

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
  window.localStorage.setItem(tourStorageKey('dashboard-overview', 1), 'done')
  window.localStorage.setItem(tourStorageKey('workspace-setup', 1), 'done')
  apiJson.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/site/public-content') return cloneDefaultPublicContentSettings()
    throw new Error(`Unexpected request: ${url}`)
  })
  sessionState.current = createSession()
})

afterEach(() => cleanup())

describe('ToolPage route guards', () => {
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
    expect(banner.closest('header')).toBeNull()
    expect(banner.parentElement).toHaveClass('mx-auto', 'max-w-7xl', 'space-y-4')
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

    await user.click((await screen.findAllByRole('button', { name: '准备这个账号' }))[1])

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/setup/operators'))
    expect(router.state.location.search).toBe('?profile_id=profile-2')
    expect(refreshProfileWorkspace).toHaveBeenCalledWith(secondProfile)
  })

  it('keeps the current dashboard section visible until the next section code is ready', async () => {
    const user = userEvent.setup()
    const router = renderToolRoute('/tool/profiles')

    await user.click(screen.getAllByRole('button', { name: '工具' })[0])

    expect(router.state.location.pathname).toBe('/tool/tools')
    expect(screen.getByRole('heading', { name: '还没有添加游戏账号' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '游戏账号' })[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('button', { name: '工具' })[0]).not.toHaveAttribute('aria-current')
    expect(screen.queryByText('正在载入...')).not.toBeInTheDocument()

    toolsSectionImport.resolve()
    expect(await screen.findByText('工具内容')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '工具' })[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { name: '还没有添加游戏账号' })).not.toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: '认证服务暂时不可用' })).toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: '前往背包升级' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/inventory'))
    expect(screen.queryByRole('dialog', { name: '背包里有可用的档案升级券' })).not.toBeInTheDocument()
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
    reorder_quotas: [],
    recent_events: [],
  }
}
