// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router'
import type { AuthUser } from '../../lib/types'
import { dashboardPath, resolveToolRoute, type DashboardSection } from '../../lib/app-routes'
import { tourStorageKey } from '../../components/GuidedTour'
import AccountDashboard from './AccountDashboard'

vi.mock('./dashboard/InventorySection', () => ({
  default: ({ onViewProfiles }: { onViewProfiles?: () => void }) => (
    <button type="button" onClick={onViewProfiles}>查看账号档案</button>
  ),
}))

afterEach(() => cleanup())

describe('AccountDashboard route navigation', () => {
  it('renders announcement unread counts as badges instead of parentheses', async () => {
    window.localStorage.setItem(tourStorageKey('dashboard-overview', 1), 'done')
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/tool/*', element: <DashboardRouteHarness announcementUnreadCount={3} /> },
    ], { initialEntries: ['/tool/profiles'] })

    render(<RouterProvider router={router} />)

    const desktopAnnouncement = screen.getByRole('button', { name: '公告 3 未读' })
    expect(within(desktopAnnouncement).getByLabelText('3 未读')).toHaveClass('tool-status')
    expect(screen.queryByText('(3)')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const mobileAnnouncement = screen.getByRole('menuitem', { name: '公告 3 未读' })
    expect(within(mobileAnnouncement).getByLabelText('3 未读')).toHaveClass('tool-status')
    await user.click(mobileAnnouncement)

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/announcements'))
    const heading = screen.getByRole('heading', { name: '公告' })
    expect(within(heading.parentElement!).getByLabelText('3 未读')).toHaveClass('tool-status')
    expect(within(screen.getByRole('button', { name: '打开栏目菜单，3 未读' })).getByLabelText('3 未读')).toHaveClass('tool-status')
  })

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

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await user.click(screen.getByRole('menuitem', { name: '工具' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/tools'))
    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '工具' })).toHaveAttribute('aria-current', 'page'))
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: '公告' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/announcements'))

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/tools'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '工具' })).toBeInTheDocument())

    await act(async () => router.navigate(1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/announcements'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '公告' })).toBeInTheDocument())
  })

  it('returns to the home page from the profiles page', async () => {
    window.localStorage.setItem(tourStorageKey('dashboard-overview', 1), 'done')
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/tool/*', element: <DashboardRouteHarness /> },
      { path: '/', element: <h1>主页</h1> },
    ], { initialEntries: ['/tool/profiles'] })

    render(<RouterProvider router={router} />)
    const accountActions = screen.getByRole('navigation', { name: '账号操作' })
    const homeLink = within(accountActions).getByRole('link', { name: '返回首页' })
    const logoutButton = within(accountActions).getByRole('button', { name: '退出登录' })
    expect(accountActions).toHaveClass('grid-cols-2', 'gap-2')
    expect(homeLink).toHaveAttribute('href', '/')
    expect(accountActions).toContainElement(logoutButton)

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    expect(screen.getByRole('menuitem', { name: '返回首页' })).toHaveAttribute('href', '/')
    await user.keyboard('{Escape}')

    await user.click(homeLink)
    expect(await screen.findByRole('heading', { name: '主页' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('pushes the profiles route from the inventory success action', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/tool/*', element: <DashboardRouteHarness /> },
    ], { initialEntries: ['/tool/inventory'] })

    render(<RouterProvider router={router} />)

    await user.click(await screen.findByRole('button', { name: '查看账号档案' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/profiles'))

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/inventory'))
  })
})

function DashboardRouteHarness({ announcementUnreadCount = 0 }: { announcementUnreadCount?: number }) {
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
      announcement={null}
      announcementUnreadCount={announcementUnreadCount}
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
