// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OptimizeShell from './OptimizeShell'

afterEach(() => cleanup())

describe('OptimizeShell compact navigation', () => {
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
        permissionLabel="高级权限"
        badges={{ result: '已有结果' }}
        showScenarioLab={false}
        onSectionChange={onSectionChange}
        onOpenTour={onOpenTour}
        onReset={onReset}
        onLogout={onLogout}
        headerActions={<button type="button">桌面任务中心</button>}
        compactHeaderActions={<button type="button" aria-label="移动任务中心" className="h-11 w-11" />}
      >
        <p>优化正文</p>
      </OptimizeShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '移动任务中心' })).toHaveClass('h-11', 'w-11')
    const accountActions = screen.getByRole('navigation', { name: '账号操作' })
    expect(within(accountActions).getByRole('button', { name: '返回数据空间' })).not.toHaveClass('tool-danger-action')
    expect(within(accountActions).getByRole('button', { name: '退出登录' })).toHaveClass('tool-danger-action')
    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    expect(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ }))
    expect(onSectionChange).toHaveBeenCalledWith('result')

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await user.click(screen.getByRole('menuitem', { name: '使用导览' }))
    expect(onOpenTour).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const reset = screen.getByRole('menuitem', { name: '返回数据空间' })
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
