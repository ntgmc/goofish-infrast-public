// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { AuthUser, UserGameAccount } from '../lib/types'
import ToolPage from './ToolPage'

const { sessionState } = vi.hoisted(() => ({ sessionState: { current: null as Record<string, unknown> | null } }))

vi.mock('./tool/useToolSession', () => ({
  useToolSession: () => sessionState.current,
}))

vi.mock('./OptimizePage', () => ({
  default: () => <main tabIndex={-1} data-route-focus>优化页</main>,
}))

beforeEach(() => {
  sessionState.current = createSession()
})

afterEach(() => cleanup())

describe('ToolPage route guards', () => {
  it('keeps a requested deep link while the user is signed out', async () => {
    const router = renderToolRoute('/tool/setup/config', { user: null })

    expect(await screen.findByRole('heading', { name: 'MAA 基建排班工作台' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/setup/config')
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
