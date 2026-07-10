// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement } from '../lib/types'
import AnnouncementPopup from './AnnouncementPopup'
import AuthForm from './AuthForm'
import BuildMetaStrip from './BuildMetaStrip'

const { apiVoidMock } = vi.hoisted(() => ({
  apiVoidMock: vi.fn(),
}))

vi.mock('../lib/api-client', () => ({
  apiJson: vi.fn(),
  apiVoid: apiVoidMock,
}))

beforeEach(() => {
  apiVoidMock.mockResolvedValue(undefined)
  window.localStorage.clear()
  document.documentElement.style.overflow = ''

  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function close(this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.documentElement.style.overflow = ''
})

describe('AnnouncementPopup accessibility', () => {
  it('opens modally, focuses the acknowledgement, and dismisses with Escape without marking read', async () => {
    const { container, opener } = createAppRoot()
    const announcement = createAnnouncement('one', '第一条公告')
    const { rerender } = render(<AnnouncementPopup announcements={[announcement]} />, { container })

    const dialog = await screen.findByRole('dialog', { name: '第一条公告' })
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '已读' })).toHaveFocus()
    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })

    const cancelEvent = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancelEvent)

    expect(cancelEvent.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    expect(window.localStorage.getItem('maa-announcement-read:one')).toBeNull()
    expect(apiVoidMock).not.toHaveBeenCalled()

    rerender(<AnnouncementPopup announcements={[{ ...announcement }]} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('marks announcements read, advances the queue, and restores focus after the last one', async () => {
    const user = userEvent.setup()
    const { container, opener } = createAppRoot()
    const first = createAnnouncement('one', '第一条公告')
    const second = createAnnouncement('two', '第二条公告')
    render(<AnnouncementPopup announcements={[first, second]} />, { container })

    await user.click(await screen.findByRole('button', { name: '已读' }))
    expect(window.localStorage.getItem('maa-announcement-read:one')).toBe(first.updated_at)
    expect(await screen.findByRole('heading', { name: '第二条公告' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '已读' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('maa-announcement-read:two')).toBe(second.updated_at)
    expect(apiVoidMock).toHaveBeenCalledTimes(2)
    expect(opener).toHaveFocus()
  })

  it('focuses the first available app control when the popup opened from body focus', async () => {
    const user = userEvent.setup()
    const root = document.createElement('div')
    root.id = 'root'
    const closedDetails = document.createElement('details')
    const hiddenLink = document.createElement('a')
    hiddenLink.href = '/hidden'
    hiddenLink.textContent = '隐藏入口'
    closedDetails.append(hiddenLink)
    const fallbackButton = document.createElement('button')
    fallbackButton.textContent = '页面首个有效控件'
    const container = document.createElement('div')
    root.append(closedDetails, fallbackButton, container)
    document.body.append(root)

    render(<AnnouncementPopup announcements={[createAnnouncement('fallback', '自动弹出公告')]} />, { container })
    await user.click(await screen.findByRole('button', { name: '已读' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fallbackButton).toHaveFocus()
  })
})

describe('mobile touch targets', () => {
  it('keeps AuthForm controls at 44px and the submit action at 48px', async () => {
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)

    const loginButtons = screen.getAllByRole('button', { name: '登录' })
    expect(loginButtons[0]).toHaveClass('min-h-11')
    expect(loginButtons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '注册' })).toHaveClass('min-h-11')
    expect(screen.getByLabelText('邮箱')).toHaveClass('min-h-11')
    expect(screen.getByLabelText('密码')).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: '忘记密码？' })).toHaveClass('min-h-11')
    expect(loginButtons[1]).toHaveClass('min-h-12')

    await user.click(screen.getByRole('button', { name: '注册' }))
    expect(screen.getByLabelText('CDK（可选）')).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: '注册' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses document flow on mobile, fixed desktop positioning, and a compact version badge', () => {
    render(<BuildMetaStrip placement="corner" />)

    const strip = screen.getByText(/当前规则数据更新于/).parentElement
    const summary = screen.getByText('版本')
    expect(strip?.className).toContain('relative')
    expect(strip?.className).toContain('sm:fixed')
    expect(strip?.className).toContain('env(safe-area-inset-bottom)')
    expect(summary).toHaveClass('px-2.5', 'py-1')
    expect(summary).not.toHaveClass('min-h-11', 'min-w-11')
  })
})

function createAnnouncement(id: string, title: string): Announcement {
  return {
    id,
    kind: 'popup',
    active: true,
    title,
    body: `${title}正文`,
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T01:00:00.000Z',
  }
}

function createAppRoot(): { container: HTMLDivElement; opener: HTMLButtonElement } {
  const root = document.createElement('div')
  root.id = 'root'
  const opener = document.createElement('button')
  opener.textContent = '打开前焦点'
  const container = document.createElement('div')
  root.append(opener, container)
  document.body.append(root)
  opener.focus()
  return { container, opener }
}
