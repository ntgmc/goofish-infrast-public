// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiJson } from '../../lib/api-client'
import DeploymentPromptPreview from './DeploymentPromptPreview'

const mocks = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('../../lib/admin-api-client', () => ({ adminApiJson: mocks.session, ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired' }))
vi.mock('../../lib/api-client', () => ({ apiJson: vi.fn() }))
vi.mock('../../lib/changelog', () => ({
  CHANGELOG_RELEASES: [4, 3, 2, 1].map((version) => ({
    id: `v2.${version}.0`, version: version === 2 ? null : `2.${version}.0`, displayVersion: `v2.${version}.0`, releasedAt: '2026-11-10', kind: 'release',
    sections: [{ id: 'fix', kind: 'fix', items: [`本地更新 ${version}`] }],
  })),
}))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.overflow = ''
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') }),
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks() })

it.each([null, {}, { username: '' }, { username: 123 }])('hides previews without a confirmed administrator (%s)', async (user) => {
  mocks.session.mockResolvedValue({ user })
  render(<DeploymentPromptPreview />)
  await waitFor(() => expect(mocks.session).toHaveBeenCalledWith('/api/admin/session'))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('stays hidden while authorization is pending or fails', async () => {
  let reject!: (error: Error) => void
  mocks.session.mockReturnValue(new Promise((_, fail) => { reject = fail }))
  render(<DeploymentPromptPreview />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  await act(async () => reject(new Error('offline')))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('repeats the update-to-welcome flow with local notes and preserves visit history and focus', async () => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  const user = userEvent.setup()
  localStorage.setItem('maatool:last-visited-build', 'existing-visit')
  const save = vi.spyOn(Storage.prototype, 'setItem')
  const fetch = vi.spyOn(window, 'fetch')
  render(<DeploymentPromptPreview />)
  const opener = await screen.findByRole('button', { name: '模拟更新提醒' })
  for (let run = 0; run < 2; run++) {
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: '新版本已发布' })).toBeInTheDocument()
    expect(screen.getByText('本地更新 4')).toBeInTheDocument()
    expect(screen.queryByText('本地更新 3')).not.toBeInTheDocument()
    expect(screen.getByText('2.1.0')).toBeInTheDocument()
    expect(screen.getByText('2.4.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模拟刷新' })).toHaveFocus()
    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })
    await user.click(screen.getByRole('button', { name: '模拟刷新' }))
    expect(screen.getByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument()
    expect(screen.getByText('本地更新 3')).toBeInTheDocument()
    expect(screen.getByText('本地更新 2')).toBeInTheDocument()
    expect(screen.queryByText('本地更新 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续使用' })).toHaveFocus()
    expect(screen.getByRole('link', { name: '查看完整更新日志' })).toHaveAttribute('href', '/changelog')
    await user.click(screen.getByRole('button', { name: '继续使用' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('')
  }
  expect(save).not.toHaveBeenCalled()
  expect(localStorage.getItem('maatool:last-visited-build')).toBe('existing-visit')
  expect(apiJson).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['模拟更新提醒', '模拟欢迎回来'])('dismisses %s with Escape or the close button and restores the opener', async (name) => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  const user = userEvent.setup()
  render(<DeploymentPromptPreview />)
  const opener = await screen.findByRole('button', { name })
  await user.click(opener)
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(screen.getByRole('dialog'), cancel)
  expect(cancel.defaultPrevented).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
  await user.click(opener)
  await user.click(screen.getByRole('button', { name: '关闭预览' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

it('closes immediately on administrator expiration and does not reopen after reauthorization', async () => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  render(<DeploymentPromptPreview />)
  fireEvent.click(await screen.findByRole('button', { name: '模拟欢迎回来' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.documentElement.style.overflow).toBe('')
  fireEvent.focus(window)
  await screen.findByRole('button', { name: '模拟欢迎回来' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
