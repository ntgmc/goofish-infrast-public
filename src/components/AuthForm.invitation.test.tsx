// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
  it('prefills the code from the share URL and allows clearing it', async () => {
    window.history.replaceState({}, '', '/tool/profiles?invite=12AB34CD5E')
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    const input = screen.getByPlaceholderText('10 位邀请码')
    expect(input).toHaveValue('12AB34CD5E')
    expect(input).not.toHaveAttribute('aria-describedby')
    await user.clear(input)
    expect(input).toHaveValue('')
  })

  it('requires an invitation code when invite-only registration is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ invite_code_required: true })))
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    const input = await screen.findByLabelText('邀请码（必填）')
    await user.type(screen.getByLabelText('邮箱'), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByText('请输入邀请码')).toHaveAttribute('role', 'alert')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-describedby', 'auth-invite-code-error')
  })

  it('announces an invalid manual invitation code', async () => {
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    const input = screen.getByPlaceholderText('10 位邀请码')
    await user.type(input, 'INVALID')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入有效的 10 位邀请码')
    expect(input).toHaveAttribute('aria-describedby', 'auth-invite-code-error')
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
