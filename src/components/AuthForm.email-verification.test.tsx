// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthForm from './AuthForm'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AuthForm email verification', () => {
  it('keeps a newly registered user signed out and offers a resend action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ invite_code_required: false }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        verification_required: true,
        message: '如果账号符合条件，请按照发送至注册邮箱的验证说明完成注册。',
        resend_after_seconds: 1,
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        message: '如果账号符合条件，请按照发送至注册邮箱的验证说明完成注册。',
        resend_after_seconds: 300,
      }, 202))
    vi.stubGlobal('fetch', fetchMock)
    const onAuthenticated = vi.fn()
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={onAuthenticated} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'new@qq.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('如果账号符合条件')
    expect(onAuthenticated).not.toHaveBeenCalled()
    const coolingButton = screen.getByRole('button', { name: '1 秒后可重新发送' })
    expect(coolingButton).toBeDisabled()
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1_050)) })
    await user.click(screen.getByRole('button', { name: '重新发送验证邮件' }))
    expect(await screen.findByText(/如果账号符合条件/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/resend-verification', expect.objectContaining({ method: 'POST' }))
  })

  it('does not offer resend after a quota-bypassed registration', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ invite_code_required: false }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        verification_required: false,
        message: '注册成功，请使用邮箱和密码登录。',
      }, 202)))
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'bypassed@qq.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('注册成功')
    expect(screen.queryByRole('button', { name: '重新发送验证邮件' })).not.toBeInTheDocument()
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

  it('applies shared email and password maximums with field-level errors', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} />)

    const email = screen.getByLabelText('邮箱')
    const password = screen.getByLabelText('密码')
    expect(email).toHaveAttribute('maxlength', '254')
    expect(password).toHaveAttribute('maxlength', '128')

    fireEvent.change(email, { target: { value: `${'a'.repeat(250)}@qq.com` } })
    fireEvent.change(password, { target: { value: 'valid-password' } })
    let loginButtons = screen.getAllByRole('button', { name: '登录' })
    await user.click(loginButtons[loginButtons.length - 1])
    expect(screen.getByText('邮箱不能超过 254 个字符')).toHaveAttribute('role', 'alert')

    fireEvent.change(email, { target: { value: 'valid@qq.com' } })
    fireEvent.change(password, { target: { value: 'p'.repeat(129) } })
    loginButtons = screen.getAllByRole('button', { name: '登录' })
    await user.click(loginButtons[loginButtons.length - 1])
    expect(screen.getByText('密码不能超过 128 位')).toHaveAttribute('role', 'alert')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['login', 'register', 'forgot'] as const)(
    'rejects oversized authentication fields in %s mode before submission',
    async (mode) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/auth/registration-settings') {
          return jsonResponse({ invite_code_required: false })
        }
        throw new Error(`Unexpected request: ${String(input)}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      const user = userEvent.setup()
      render(<AuthForm onAuthenticated={vi.fn()} />)

      if (mode === 'register') await user.click(screen.getByRole('button', { name: '注册' }))
      if (mode === 'forgot') await user.click(screen.getByRole('button', { name: '忘记密码？' }))
      const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')
      expect(submit).not.toBeNull()

      const email = screen.getByLabelText('邮箱')
      const password = mode === 'forgot' ? null : screen.getByLabelText('密码')
      fireEvent.change(email, { target: { value: `${'a'.repeat(250)}@qq.com` } })
      if (mode !== 'forgot') {
        fireEvent.change(password!, { target: { value: 'valid-password' } })
      }
      await user.click(submit!)
      expect(screen.getByText('邮箱不能超过 254 个字符')).toHaveAttribute('role', 'alert')

      if (mode !== 'forgot') {
        fireEvent.change(email, { target: { value: 'valid@qq.com' } })
        fireEvent.change(password!, { target: { value: 'p'.repeat(129) } })
        await user.click(submit!)
        expect(screen.getByText('密码不能超过 128 位')).toHaveAttribute('role', 'alert')
      }

      expect(fetchMock.mock.calls.filter(([input]) => (
        String(input) !== '/api/auth/registration-settings'
      ))).toHaveLength(0)
    },
  )
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
