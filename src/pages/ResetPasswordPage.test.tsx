// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResetPasswordPage from './ResetPasswordPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResetPasswordPage password constraints', () => {
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
