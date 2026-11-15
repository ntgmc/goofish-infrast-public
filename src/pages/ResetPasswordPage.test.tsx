// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResetPasswordPage from './ResetPasswordPage'
import { rememberAuthReturn } from '../lib/auth-navigation'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('ResetPasswordPage password constraints', () => {
  it('keeps the success result visible and offers login with the original task', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(null, '', '/reset-password?token=reset-test-token')
    rememberAuthReturn('/v2?section=depot')
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'password123' } })
    await userEvent.click(screen.getByRole('button', { name: '重置密码' }))
    expect(await screen.findByRole('status')).toHaveTextContent('密码已重置，请使用新密码登录。')
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute('href', '/login?return_to=%2Fv2%3Fsection%3Ddepot')
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('limits both password fields and reports the shared maximum', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/reset-password?token=valid-token')
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)

    const password = screen.getByLabelText('新密码')
    const confirmation = screen.getByLabelText('确认新密码')
    expect(password).toHaveAttribute('maxlength', '128')
    expect(confirmation).toHaveAttribute('maxlength', '128')

    fireEvent.change(password, { target: { value: 'p'.repeat(129) } })
    fireEvent.change(confirmation, { target: { value: 'p'.repeat(129) } })
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getAllByText('密码不能超过 128 位')).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
