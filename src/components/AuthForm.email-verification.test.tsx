// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthForm from './AuthForm'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthForm email verification', () => {
  it('keeps a newly registered user signed out and offers a resend action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        verification_required: true,
        message: '请检查邮箱并点击验证链接完成注册。',
        resend_after_seconds: 300,
      }, 202))
      .mockResolvedValueOnce(jsonResponse({ message: '验证邮件已重新发送。' }))
    vi.stubGlobal('fetch', fetchMock)
    const onAuthenticated = vi.fn()
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={onAuthenticated} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('请检查邮箱')
    expect(onAuthenticated).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '重新发送验证邮件' }))
    expect(await screen.findByText('验证邮件已重新发送。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/resend-verification', expect.objectContaining({ method: 'POST' }))
  })

  it('offers resend when login is rejected as unverified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '请先验证邮箱后再登录。', code: 'email_not_verified' }, 403)))
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.type(screen.getByLabelText('邮箱'), 'pending@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    const loginButtons = screen.getAllByRole('button', { name: '登录' })
    await user.click(loginButtons[loginButtons.length - 1])
    expect(await screen.findByRole('alert')).toHaveTextContent('请先验证邮箱')
    expect(screen.getByRole('button', { name: '重新发送验证邮件' })).toBeInTheDocument()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
