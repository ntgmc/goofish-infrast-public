// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompactHeaderMenu from './CompactHeaderMenu'

afterEach(() => cleanup())

describe('CompactHeaderMenu', () => {
  it('renders an accessible 44px trigger and the complete menu state', async () => {
    const user = userEvent.setup()
    const onCurrent = vi.fn()
    const onDanger = vi.fn()
    renderMenu({ onCurrent, onDanger })

    const trigger = screen.getByRole('button', { name: '打开栏目菜单' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveClass('h-11')

    await user.click(trigger)

    expect(screen.getByText('测试账号')).toBeInTheDocument()
    const currentItem = screen.getByRole('menuitem', { name: /当前栏目.*3/ })
    expect(currentItem).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('3')).toHaveClass('tool-status')
    expect(screen.getByRole('menuitem', { name: '链接栏目' })).toHaveAttribute('href', '/linked')
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toHaveClass('text-error')

    await user.click(currentItem)
    expect(onCurrent).toHaveBeenCalledOnce()
  })

  it('supports Router links and blocks disabled actions', async () => {
    const user = userEvent.setup()
    const onDisabled = vi.fn()
    renderMenu({ onDisabled })

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    const disabledItem = screen.getByRole('menuitem', { name: '禁用栏目' })
    expect(disabledItem).toHaveAttribute('data-disabled')
    await user.click(disabledItem)
    expect(onDisabled).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: '链接栏目' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/linked')
  })

  it('supports keyboard selection, Escape, and focus restoration', async () => {
    const user = userEvent.setup()
    const onCurrent = vi.fn()
    renderMenu({ onCurrent })
    const trigger = screen.getByRole('button', { name: '打开栏目菜单' })

    trigger.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    expect(onCurrent).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps the menu visible in the live mobile viewport without locking a scrolled page', async () => {
    const user = userEvent.setup()
    renderMenu()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 720 })
    window.dispatchEvent(new Event('scroll'))

    await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))

    const menu = screen.getByRole('menu')
    expect(menu).toBeVisible()
    expect(menu).toHaveStyle({
      maxHeight: 'min(32rem, calc(100dvh - 5rem), var(--radix-dropdown-menu-content-available-height))',
    })
    expect(menu.closest('[data-radix-popper-content-wrapper]')).toHaveStyle({ position: 'fixed' })
    expect(document.body.style.pointerEvents).toBe('')
    expect(document.body.style.overflow).toBe('')
  })
})

function renderMenu({
  onCurrent = vi.fn(),
  onDisabled = vi.fn(),
  onDanger = vi.fn(),
}: {
  onCurrent?: () => void
  onDisabled?: () => void
  onDanger?: () => void
} = {}) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <CompactHeaderMenu
        ariaLabel="打开栏目菜单"
        triggerLabel="当前栏目"
        metadata={{ title: '测试账号', description: '只读说明' }}
        items={[
          { type: 'button', id: 'current', label: '当前栏目', current: true, badge: '3', onSelect: onCurrent },
          { type: 'link', id: 'link', label: '链接栏目', to: '/linked' },
          { type: 'button', id: 'disabled', label: '禁用栏目', disabled: true, onSelect: onDisabled },
          { type: 'separator', id: 'separator' },
          { type: 'button', id: 'danger', label: '退出登录', intent: 'danger', onSelect: onDanger },
        ]}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>
}
