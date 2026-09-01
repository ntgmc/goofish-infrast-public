// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthForm from './AuthForm'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ invite_code_required: false })))
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthForm invitation code', () => {
  it('prefills a fragment invitation without leaving it in the address bar', async () => {
    window.history.replaceState({}, '', '/tool/profiles#invite=12AB34CD5E6F7G8H')

    render(<AuthForm onAuthenticated={vi.fn()} />)

    expect(screen.getByLabelText('邀请码（可选）')).toHaveValue('12AB34CD5E6F7G8H')
    await waitFor(() => expect(window.location.hash).toBe(''))
  })

  it('prefills the code from the share URL and allows clearing it', async () => {
    window.history.replaceState({}, '', '/tool/profiles?invite=12AB34CD5E6F7G8H')
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    const input = screen.getByPlaceholderText('输入 10 位好友邀请码或 16 位管理员邀请码')
    expect(input).toHaveValue('12AB34CD5E6F7G8H')
    expect(input).not.toHaveAttribute('aria-describedby')
    await user.clear(input)
    expect(input).toHaveValue('')
  })

  it('requires an invitation code when invite-only registration is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ invite_code_required: true })))
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    const input = await screen.findByLabelText('管理员邀请码（必填）')
    await user.type(screen.getByLabelText('邮箱'), 'new@qq.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByText('请输入管理员邀请码')).toHaveAttribute('role', 'alert')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-describedby', 'auth-invite-code-error')
  })

  it('announces an invalid manual invitation code', async () => {
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'new@qq.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    const input = screen.getByPlaceholderText('输入 10 位好友邀请码或 16 位管理员邀请码')
    await user.type(input, 'INVALID')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('好友邀请码为 10 位，管理员邀请码为 16 位')
    expect(input).toHaveAttribute('aria-describedby', 'auth-invite-code-error')
  })

  it('blocks registration until failed registration settings can be retried', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValue(jsonResponse({ invite_code_required: false }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法注册')
    expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
