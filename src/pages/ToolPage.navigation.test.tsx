// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AuthUser, UserGameAccount } from '../lib/types'
import ToolPage from './ToolPage'

const { sessionState, toolsSectionImport } = vi.hoisted(() => {
  let resolveToolsSection!: () => void
  return {
    sessionState: { current: null as Record<string, unknown> | null },
    toolsSectionImport: {
      pending: new Promise<void>((resolve) => { resolveToolsSection = resolve }),
      resolve: () => resolveToolsSection(),
    },
  }
})

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

  it('updates the active dashboard tab immediately while its code is still loading', async () => {
    const user = userEvent.setup()
    const router = renderToolRoute('/tool/profiles')

    await user.click(screen.getAllByRole('button', { name: '工具' })[0])

    expect(router.state.location.pathname).toBe('/tool/tools')
    expect(screen.getAllByRole('button', { name: '工具' })[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: '工具' })).toBeInTheDocument()
    expect(screen.getByText('正在载入...')).toBeInTheDocument()

    toolsSectionImport.resolve()
    expect(await screen.findByText('工具内容')).toBeInTheDocument()
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

  it('normalizes invalid optimize paths and rejects an unavailable lab with replace navigation', async () => {
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
    await waitFor(() => expect(unavailableLab.state.location.pathname).toBe('/tool/optimize/overview'))
    expect(await screen.findByText('优化页')).toBeInTheDocument()
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
    setEliteOverrides: vi.fn(),
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
