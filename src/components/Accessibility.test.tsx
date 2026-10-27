// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement } from '../lib/types'
import AnnouncementPopup from './AnnouncementPopup'
import AuthForm from './AuthForm'
import DeferredFeatureMenu from './DeferredFeatureMenu'
import ThemeSwitcher from './ThemeSwitcher'

const { apiJsonMock, apiVoidMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  apiVoidMock: vi.fn(),
}))

vi.mock('../lib/api-client', async (importOriginal) => {
  const { getApiErrorMessage } = await importOriginal<typeof import('../lib/api-client')>()
  return { apiJson: apiJsonMock, apiVoid: apiVoidMock, getApiErrorMessage }
})

beforeEach(() => {
  apiJsonMock.mockReset().mockResolvedValue({ invite_code_required: false })
  apiVoidMock.mockReset().mockResolvedValue(undefined)
  window.localStorage.clear()
  window.sessionStorage.clear()
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
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.documentElement.style.overflow = ''
  vi.useRealTimers()
})

describe('AnnouncementPopup accessibility', () => {
  it('opens modally, focuses the defer action, and dismisses with Escape without marking read', async () => {
    const { container, opener } = createAppRoot()
    const announcement = createAnnouncement('escape-one', '第一条公告')
    const { rerender } = render(<MemoryRouter><AnnouncementPopup announcements={[announcement]} /></MemoryRouter>, { container })

    const dialog = await screen.findByRole('dialog', { name: '第一条公告' })
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '稍后查看' })).toHaveFocus()
    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })

    const cancelEvent = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancelEvent)

    expect(cancelEvent.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    expect(window.localStorage.getItem('maa-announcement-read:escape-one')).toBeNull()
    expect(apiVoidMock).toHaveBeenCalledWith('/api/usage-stats', expect.objectContaining({
      json: expect.objectContaining({ event: 'announcement_impression', announcement_id: 'escape-one' }),
    }))
    expect(apiVoidMock.mock.calls.some(([, init]) => init.json.event === 'announcement_read')).toBe(false)

    rerender(<MemoryRouter><AnnouncementPopup announcements={[{ ...announcement }]} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('acknowledges only one reminder and keeps the other announcements unread across remounts', async () => {
    const user = userEvent.setup()
    const { container, opener } = createAppRoot()
    const first = createAnnouncement('one', '第一条公告')
    const second = createAnnouncement('two', '第二条公告')
    const { rerender } = render(<MemoryRouter><AnnouncementPopup announcements={[first, second]} /></MemoryRouter>, { container })

    await user.click(await screen.findByRole('button', { name: '已读' }))
    expect(window.localStorage.getItem('maa-announcement-read:one')).toBe(first.updated_at)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('maa-announcement-read:two')).toBeNull()
    await waitFor(() => expect(apiVoidMock).toHaveBeenCalledTimes(2))
    expect(opener).toHaveFocus()

    rerender(<MemoryRouter><AnnouncementPopup key="remounted" announcements={[second]} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves ordinary and expired announcements in the inbox without opening a modal', () => {
    const ordinary = createAnnouncement('ordinary', '普通公告')
    delete ordinary.popup_until
    const ended = { ...createAnnouncement('ended', '过期公告'), popup_until: new Date(Date.now() - 1000).toISOString() }
    render(<MemoryRouter><AnnouncementPopup announcements={[ordinary, ended]} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('maa-announcement-popup-shown')).toBeNull()
  })

  it('defers without marking read or reappearing when the user signs in', async () => {
    const user = userEvent.setup()
    const first = createAnnouncement('defer-first', '稍后查看公告')
    const second = createAnnouncement('defer-second', '其他公告')
    const { rerender } = render(<MemoryRouter><AnnouncementPopup announcements={[first, second]} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: '稍后查看' }))
    expect(window.localStorage.getItem('maa-announcement-read:defer-first')).toBeNull()
    rerender(<MemoryRouter><AnnouncementPopup announcements={[first, second]} userId="signed-in-after-defer" /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiJsonMock).not.toHaveBeenCalled()
  })

  it('skips an acknowledged leading reminder instead of replaying older unread announcements', () => {
    const first = createAnnouncement('already-read', '已读公告')
    const second = createAnnouncement('older-unread', '较早公告')
    window.localStorage.setItem('maa-announcement-read:already-read', first.updated_at)
    render(<MemoryRouter><AnnouncementPopup announcements={[first, second]} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes at the reminder deadline without marking the announcement read', async () => {
    vi.useFakeTimers()
    const announcement = { ...createAnnouncement('expires-open', '即将到期公告'), popup_until: new Date(Date.now() + 1000).toISOString() }
    const { container, opener } = createAppRoot()
    render(<MemoryRouter><AnnouncementPopup announcements={[announcement]} /></MemoryRouter>, { container })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('maa-announcement-read:expires-open')).toBeNull()
    expect(opener).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('shows acknowledgement errors in the modal and permits deferring after failure', async () => {
    const user = userEvent.setup()
    const announcement = createAnnouncement('read-failure', '标记失败公告')
    apiJsonMock.mockResolvedValueOnce({ announcements: [{ announcement, read_at: null }], unread_count: 1 })
      .mockRejectedValueOnce(new Error('连接中断'))
    render(<MemoryRouter><AnnouncementPopup announcements={[announcement]} userId="read-failure-user" /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: '已读' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断')
    expect(screen.getByRole('button', { name: '已读' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '稍后查看' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiVoidMock.mock.calls.some(([, init]) => init.json.event === 'announcement_read')).toBe(false)
  })

  it('dismisses the popup when an announcement link navigates inside the app', async () => {
    const user = userEvent.setup()
    const { container } = createAppRoot()
    const announcement = {
      ...createAnnouncement('internal-link', '带入口公告'),
      body: '[打开背包](/tool/inventory)',
    }
    render(<MemoryRouter><AnnouncementPopup announcements={[announcement]} /></MemoryRouter>, { container })

    await user.click(await screen.findByRole('link', { name: '打开背包' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('maa-announcement-read:internal-link')).toBeNull()
  })

  it('keeps working when localStorage access is blocked', async () => {
    const user = userEvent.setup()
    const { container } = createAppRoot()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })

    render(<MemoryRouter><AnnouncementPopup announcements={[createAnnouncement('storage-blocked', '受限存储公告')]} /></MemoryRouter>, { container })
    await user.click(await screen.findByRole('button', { name: '已读' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses server reads for logged-in users and updates the shared unread count', async () => {
    const user = userEvent.setup()
    const onUnreadCountChange = vi.fn()
    const announcement = createAnnouncement('server-read', '登录公告')
    apiJsonMock
      .mockResolvedValueOnce({ announcements: [{ announcement, read_at: null }], unread_count: 1 })
      .mockResolvedValueOnce({ announcements: [{ announcement, read_at: '2026-07-31T02:00:00.000Z' }], unread_count: 0 })
    const { container } = createAppRoot()
    render(
      <MemoryRouter>
        <AnnouncementPopup announcements={[announcement]} userId="user-1" onUnreadCountChange={onUnreadCountChange} />
      </MemoryRouter>,
      { container },
    )

    await user.click(await screen.findByRole('button', { name: '已读' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiJsonMock).toHaveBeenLastCalledWith('/api/user/announcements', {
      method: 'PATCH', json: { announcement_id: 'server-read', updated_at: announcement.updated_at },
    })
    expect(onUnreadCountChange).toHaveBeenLastCalledWith(0)
    expect(window.localStorage.getItem('maa-announcement-read:server-read')).toBeNull()
    expect(apiVoidMock.mock.calls.some(([, init]) => init.json.event === 'announcement_read')).toBe(true)
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

    render(<MemoryRouter><AnnouncementPopup announcements={[createAnnouncement('fallback', '自动弹出公告')]} /></MemoryRouter>, { container })
    await user.click(await screen.findByRole('button', { name: '已读' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fallbackButton).toHaveFocus()
  })
})

describe('mobile touch targets', () => {
  it('keeps toolbar theme and more controls at the same 44px height', () => {
    render(
      <MemoryRouter>
        <ThemeSwitcher />
        <DeferredFeatureMenu />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /选择主题/ })).toHaveClass('h-11', 'py-0')
    expect(screen.getByText('更多')).toHaveClass('h-11', 'py-0')
  })

  it('keeps icon-only toolbar controls square and accessibly named', () => {
    render(
      <MemoryRouter>
        <ThemeSwitcher iconOnly />
        <DeferredFeatureMenu iconOnly />
      </MemoryRouter>,
    )

    const theme = screen.getByRole('button', { name: /选择主题：/ })
    expect(theme).toHaveClass('h-11', 'w-11', 'px-0')
    expect(theme).not.toHaveTextContent('跟随系统')

    const more = screen.getByText('', { selector: 'summary[aria-label="更多操作"]' })
    expect(more).toHaveClass('h-11', 'w-11', 'px-0')
    expect(more).toHaveAccessibleName('更多操作')
  })

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

})

function createAnnouncement(id: string, title: string): Announcement {
  return {
    id,
    kind: 'popup',
    active: true,
    title,
    body: `${title}正文`,
    popup_until: new Date(Date.now() + 86_400_000).toISOString(),
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
