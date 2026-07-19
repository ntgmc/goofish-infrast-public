// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import type { AuthUser } from '../../lib/types'
import { dashboardPath, resolveToolRoute, type DashboardSection } from '../../lib/app-routes'
import { tourStorageKey } from '../../components/GuidedTour'
import AccountDashboard from './AccountDashboard'

afterEach(() => cleanup())

describe('AccountDashboard route navigation', () => {
  it('shows the first-run overview without changing the current dashboard route', async () => {
    window.localStorage.removeItem(tourStorageKey('dashboard-overview', 1))
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/tool/*', element: <DashboardRouteHarness /> },
    ], { initialEntries: ['/tool/profiles'] })

    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: '管理游戏账号' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tool/profiles')

    await user.click(screen.getByRole('button', { name: '跳过导览' }))
    expect(router.state.location.pathname).toBe('/tool/profiles')
    expect(window.localStorage.getItem(tourStorageKey('dashboard-overview', 1))).toBe('done')
  })

  it('pushes page navigation and restores the active page with back and forward', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/tool/*', element: <DashboardRouteHarness /> },
    ], { initialEntries: ['/tool/profiles'] })

    render(<RouterProvider router={router} />)
    expect(screen.getByRole('heading', { name: '游戏账号' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '工具' })[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/tools'))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '工具' })[0]).toHaveAttribute('aria-current', 'page'))

    await user.click(screen.getAllByRole('button', { name: '公告' })[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/announcements'))

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/tools'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '工具' })).toBeInTheDocument())

    await act(async () => router.navigate(1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/announcements'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '公告' })).toBeInTheDocument())
  })
})

function DashboardRouteHarness() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = resolveToolRoute(location.pathname)
  if (!route || route.kind !== 'dashboard') return null

  const handleSectionChange = (section: DashboardSection, options?: { replace?: boolean }) => {
    navigate(dashboardPath(section), { replace: options?.replace })
  }

  return (
    <AccountDashboard
      user={{ id: 'user-1', email: 'test@example.com' } as AuthUser}
      profiles={[]}
      activeProfile={null}
      announcementUnreadCount={0}
      openingProfileId={null}
      workspaceLoadError={null}
      section={route.section}
      onSectionChange={handleSectionChange}
      onLogout={vi.fn()}
      onPayload={vi.fn()}
      onOpenProfile={vi.fn()}
    />
  )
}
