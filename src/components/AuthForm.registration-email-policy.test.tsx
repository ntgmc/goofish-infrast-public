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

describe('AuthForm registration email policy', () => {
  it('shows the public-email restriction only after registration email validation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ invite_code_required: false })))
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))

    const restriction = '仅支持常用公共邮箱；不支持企业、自建、临时或别名邮箱。'
    const emailField = screen.getByLabelText('邮箱')
    expect(screen.queryByText(restriction)).not.toBeInTheDocument()
    expect(emailField).not.toHaveAttribute('aria-describedby')

    await user.type(emailField, 'user@company.example')
    await user.tab()

    expect(await screen.findByText(restriction)).toHaveAttribute('role', 'alert')
    expect(emailField).toHaveAttribute('aria-describedby', 'auth-email-error')
  })

  it('blocks a typo on blur, lets the user apply its suggestion, and waits for submit before requesting registration', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ invite_code_required: false }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        verification_required: true,
        message: '已发送注册验证邮件，请检查您的收件箱，并在邮件中确认。',
      }, 202))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    const emailField = screen.getByLabelText('邮箱')
    await user.type(emailField, 'correct@gmial.com')
    await user.tab()

    expect(await screen.findByText('邮箱域名可能有误，请使用建议地址。')).toHaveAttribute('role', 'alert')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/register')).toBe(false)

    await user.click(screen.getByRole('button', { name: '使用 correct@gmail.com' }))
    expect(emailField).toHaveValue('correct@gmail.com')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/register')).toBe(false)

    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('请检查您的收件箱')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({ method: 'POST' }))
  })

  it('renders API registration-policy failures as an email field error with its suggestion', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ invite_code_required: false }))
      .mockResolvedValueOnce(jsonResponse({
        error: '注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”并使用 gmail.com。',
        code: 'email_alias_not_allowed',
        suggested_email: 'username@gmail.com',
      }, 400))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'username@gmail.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByText('注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”并使用 gmail.com。')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: '使用 username@gmail.com' })).toBeInTheDocument()
  })

  it('does not apply the registration provider policy to login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: 'legacy-user', email: 'legacy@example.com' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onAuthenticated = vi.fn()
    const user = userEvent.setup()

    render(<AuthForm onAuthenticated={onAuthenticated} />)
    await user.type(screen.getByLabelText('邮箱'), 'legacy@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    const loginButtons = screen.getAllByRole('button', { name: '登录' })
    await user.click(loginButtons[loginButtons.length - 1])

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }))
    expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ email: 'legacy@example.com' }) }))
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
