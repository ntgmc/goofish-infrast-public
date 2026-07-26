// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
        headerActions={<button type="button">桌面任务中心</button>}
        compactHeaderActions={<button type="button" aria-label="移动任务中心" className="h-11 w-11" />}
      >
        <p>优化正文</p>
      </OptimizeShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '移动任务中心' })).toHaveClass('h-11', 'w-11')
    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    expect(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /排班结果.*已有结果/ }))
    expect(onSectionChange).toHaveBeenCalledWith('result')

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await user.click(screen.getByRole('menuitem', { name: '使用导览' }))
    expect(onOpenTour).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const reset = screen.getByRole('menuitem', { name: '返回数据空间' })
    expect(reset).toHaveClass('text-error')
    await user.click(reset)
    expect(onReset).toHaveBeenCalledOnce()

    expect(screen.getByRole('navigation', { name: '排班工作台分区' })).toBeInTheDocument()
  })
})
