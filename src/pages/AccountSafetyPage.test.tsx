// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountSafetyPage from './AccountSafetyPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AccountSafetyPage lifecycle controls', () => {
  it('does not render the personal data export control', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '调试模式' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出个人数据' })).not.toBeInTheDocument()
  })

  it('shows the scheduled deletion and queued cancellation email before leaving', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      scheduled_for: '2026-08-07T00:00:00.000Z',
      cancellation_email: 'queued',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } })))
    renderPage()

    const email = screen.getByLabelText('账号邮箱')
    const password = screen.getByLabelText('当前密码')
    expect(email).toHaveAttribute('maxlength', '254')
    expect(password).toHaveAttribute('maxlength', '128')
    await user.type(email, 'user@example.test')
    await user.type(password, 'password')
    await user.click(screen.getByRole('button', { name: '申请注销' }))

    expect(await screen.findByText('注销申请已受理')).toBeInTheDocument()
    expect(screen.getByText(/撤销邮件正在发送/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '申请注销' })).not.toBeInTheDocument()
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountSafetyPage />
    </MemoryRouter>,
  )
}
