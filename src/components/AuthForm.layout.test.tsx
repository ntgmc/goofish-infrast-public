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

describe('AuthForm feedback spacing', () => {
  it('does not reserve an empty feedback block before the email field', () => {
    const { container } = render(<AuthForm onAuthenticated={vi.fn()} compact />)
    const modeSwitcher = screen.getByRole('group', { name: '登录方式' })
    const feedback = container.querySelector<HTMLElement>('.auth-feedback-slot')
    const emailField = screen.getByLabelText('邮箱').closest('label')

    expect(feedback).toBeEmptyDOMElement()
    expect(feedback).not.toHaveClass('mt-4')
    expect(feedback?.parentElement).toBe(modeSwitcher.parentElement)
    expect(emailField?.previousElementSibling).toBe(modeSwitcher.parentElement)
  })

  it('adds spacing and keeps the live region when feedback is visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '邮箱或密码不正确。' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })))
    const user = userEvent.setup()
    render(<AuthForm onAuthenticated={vi.fn()} compact />)

    await user.type(screen.getByLabelText('邮箱'), 'user@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    const loginButtons = screen.getAllByRole('button', { name: '登录' })
    await user.click(loginButtons[loginButtons.length - 1])

    const feedback = (await screen.findByRole('alert')).parentElement
    expect(feedback).toHaveClass('mt-4')
    expect(feedback).toHaveAttribute('aria-live', 'polite')
    expect(feedback).toHaveAttribute('aria-atomic', 'true')
  })
})

describe('AuthForm registration field spacing', () => {
  it('does not reserve hidden error-message space between registration inputs', async () => {
    const user = userEvent.setup()
    const { container } = render(<AuthForm onAuthenticated={vi.fn()} compact />)

    await user.click(screen.getByRole('button', { name: '注册' }))

    const fields = ['邮箱', '密码', 'CDK（可选）', '邀请码（可选）'].map((name) => screen.getByLabelText(name))
    expect(container.querySelectorAll('.auth-field-message')).toHaveLength(0)
    fields.forEach((field) => {
      expect(field.closest('label')).toHaveClass('block')
      expect(field.closest('label')?.querySelector('.auth-field-message')).toBeNull()
    })
  })

  it('renders and associates field messages only after validation fails', async () => {
    const user = userEvent.setup()
    const { container } = render(<AuthForm onAuthenticated={vi.fn()} compact />)

    await user.click(screen.getByRole('button', { name: '注册' }))
    const emailField = screen.getByLabelText('邮箱')
    const passwordField = screen.getByLabelText('密码')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(container.querySelectorAll('.auth-field-message')).toHaveLength(2)
    expect(emailField).toHaveAttribute('aria-describedby', 'auth-email-error')
    expect(passwordField).toHaveAttribute('aria-describedby', 'auth-password-error')
    expect(screen.getByText('请输入邮箱')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('请输入密码')).toHaveAttribute('role', 'alert')
  })
})
