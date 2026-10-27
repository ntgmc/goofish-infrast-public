// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '../../../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { useToolSession } from '../useToolSession'
import { normalizeConfig } from '../../../lib/config'
import type { AuthSuccessResponse } from '../../../lib/types'
import { copy } from '../../../copy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OptimizeShell from './OptimizeShell'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('OptimizeShell compact navigation', () => {
  it.each(['desktop', 'mobile'])('flushes the real draft before the %s V2 entry and stays on save failure', async (entry) => {
    const config = normalizeConfig({ desc: 'base', layout: '2-4-3', schedule_mode: 'maa', dormitory_rule: 'fixed', trading_stations_count: 2, manufacturing_stations_count: 4,
      product_requirements: { trading_stations: { gold: 2 }, manufacturing_stations: { gold: 2, exp: 2 } } })
    let fail = true
    let saved!: (value: Response) => void
    const pendingSave = new Promise<Response>((resolve) => { saved = resolve })
    let current!: ReturnType<typeof useToolSession>
    const payload = { user: { id: 'user' }, profiles: [{ id: 'profile', kind: 'cdk' }], active_profile: { id: 'profile', kind: 'cdk' },
      workspace: { profile_id: 'profile', operators: [], config, elite_overrides: {}, saved_configs: [], result_history: [] } } as unknown as AuthSuccessResponse
    const fetch = vi.fn(async (_url, init) => init?.method === 'PATCH' && !fail ? pendingSave : new Response(JSON.stringify(init?.method === 'PATCH' && fail ? { error: 'save failed' } : payload), {
      status: init?.method === 'PATCH' && fail ? 503 : 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    function Harness() {
      current = useToolSession('profile', false, false)
      return <><output data-testid="location">{useLocation().pathname}</output><OptimizeShell section="config" profileId="profile" profileLabel="profile" permissionLabel="advanced"
        showScenarioLab={false} onSectionChange={() => {}} onOpenTour={() => {}} onReset={() => {}} onLogout={() => {}} flushConfigSave={current.flushConfigSave}>
        <button onClick={() => current.setConfigOverride({ ...config, desc: 'draft' })}>Edit</button>
      </OptimizeShell></>
    }
    render(<MemoryRouter initialEntries={['/tool/optimize/config']}><Harness /></MemoryRouter>)
    await waitFor(() => expect(current.authStatus).toBe('authenticated'))
    const user = userEvent.setup()
    await user.click(screen.getByText('Edit'))
    const open = async () => {
      if (entry === 'mobile') {
        await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
        await user.click(screen.getByRole('menuitem', { name: copy.v2.testEntry }))
      } else await user.click(screen.getByRole('link', { name: new RegExp(copy.v2.testEntry) }))
    }
    await open()
    await waitFor(() => expect(current.configSyncStatus).toBe('failed'))
    expect(screen.getByTestId('location')).toHaveTextContent('/tool/optimize/config')
    expect(current.configOverride?.desc).toBe('draft')
    fail = false
    if (entry === 'mobile') await user.keyboard('{Escape}')
    await open()
    await waitFor(() => expect(current.configSyncStatus).toBe('saving'))
    expect(screen.getByTestId('location')).toHaveTextContent('/tool/optimize/config')
    await act(async () => { saved(new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })) })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/v2'))
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2)
    expect(current.configOverride).toBeNull()
  })
  it('switches sections and preserves badges, tour, reset, and direct task actions', async () => {
    const user = userEvent.setup()
    const onSectionChange = vi.fn()
    const onOpenTour = vi.fn()
    const onReset = vi.fn()
    const onLogout = vi.fn()
    render(
      <MemoryRouter>
      <OptimizeShell
        section="overview"
        profileId="profile-1"
        profileLabel="高级账号"
        permissionLabel="高级权限"
        badges={{ result: '已有结果' }}
        showScenarioLab={false}
        onSectionChange={onSectionChange}
        onOpenTour={onOpenTour}
        onReset={onReset}
        onLogout={onLogout}
        flushConfigSave={async () => true}
        headerActions={<button type="button">桌面任务中心</button>}
        compactHeaderActions={<button type="button" aria-label="移动任务中心" className="h-11 w-11" />}
      >
        <p>优化正文</p>
      </OptimizeShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '移动任务中心' })).toHaveClass('h-11', 'w-11')
    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' })
    expect(within(breadcrumb).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
    expect(within(breadcrumb).getByRole('link', { name: '游戏账号' })).toHaveAttribute('href', '/tool/profiles')
    expect(within(breadcrumb).getByRole('link', { name: '高级账号' })).toHaveAttribute('href', '/tool/profiles?profile_id=profile-1')
    expect(within(breadcrumb).getByRole('link', { name: '排班工作台' })).toHaveAttribute('href', '/tool/optimize/overview?profile_id=profile-1')
    expect(within(breadcrumb).getByText('总览')).toHaveAttribute('aria-current', 'page')
    const accountActions = screen.getByRole('navigation', { name: '账号操作' })
    expect(within(accountActions).getByRole('button', { name: '返回工作区' })).not.toHaveClass('tool-danger-action')
    expect(within(accountActions).getByRole('button', { name: '退出登录' })).toHaveClass('tool-danger-action')
    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    expect(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ }))
    expect(onSectionChange).toHaveBeenCalledWith('result')

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await user.click(screen.getByRole('menuitem', { name: '使用导览' }))
    expect(onOpenTour).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const reset = screen.getByRole('menuitem', { name: '返回工作区' })
    expect(reset).not.toHaveClass('text-error')
    await user.click(reset)
    expect(onReset).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const logout = screen.getByRole('menuitem', { name: '退出登录' })
    expect(logout).toHaveClass('text-error')
    await user.click(logout)
    expect(onLogout).toHaveBeenCalledOnce()

    expect(screen.getByRole('navigation', { name: '排班工作台分区' })).toBeInTheDocument()
  })
})
