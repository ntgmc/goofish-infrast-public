// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsSection from './SettingsSection'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SettingsSection privacy controls', () => {
  it('hides removed data controls and keeps destructive account controls', () => {
    render(<SettingsSection profiles={[{
      id: 'profile-1', user_id: 'user-1', kind: 'depot_value', permission: 'growth', status: 'active', cdk_order_hash: null,
      display_name: '仓库分析', note: '', skland_binding: null, operator_count: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: null,
    }]} onLogout={vi.fn()} onPayload={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '数据与隐私' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出个人数据' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤回仓库样本' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发起注销请求' })).toBeDisabled()
  })

  it('allows clearing credentials without offering to unlink the bound UID', () => {
    render(<SettingsSection profiles={[{
      id: 'profile-1', user_id: 'user-1', kind: 'cdk', permission: 'growth', status: 'active', cdk_order_hash: 'order-1',
      display_name: '账号 1', note: '', operator_count: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: null,
      skland_binding: {
        uid: '12345678', nickname: '博士', channel_name: '官服', bound_at: '2026-01-01T00:00:00.000Z',
        last_imported_at: null, credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null,
      },
    }]} onLogout={vi.fn()} onPayload={vi.fn()} />)

    expect(screen.getByRole('button', { name: '清除凭据' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '解绑森空岛' })).not.toBeInTheDocument()
    expect(screen.getByText(/不会解除游戏账号绑定/)).toBeInTheDocument()
  })

  it('limits all change-password fields and reports oversized passwords', async () => {
    const user = userEvent.setup()
    render(<SettingsSection profiles={[]} onLogout={vi.fn()} onPayload={vi.fn()} />)
    const oldPassword = screen.getByLabelText('当前密码', { selector: '#settings-old-password' })
    const newPassword = screen.getByLabelText('新密码')
    const confirmation = screen.getByLabelText('确认新密码')

    for (const field of [oldPassword, newPassword, confirmation]) {
      expect(field).toHaveAttribute('maxlength', '128')
      fireEvent.change(field, { target: { value: 'p'.repeat(129) } })
    }
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    expect(screen.getAllByText('密码不能超过 128 位')).toHaveLength(3)
  })

  it('refreshes the session and shows a completed credential state after clearing', async () => {
    const user = userEvent.setup()
    const onPayload = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-1' }, profiles: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SettingsSection profiles={[{
      id: 'profile-1', user_id: 'user-1', kind: 'cdk', permission: 'growth', status: 'active', cdk_order_hash: 'order-1',
      display_name: '账号 1', note: '', operator_count: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: null,
      skland_binding: {
        uid: '12345678', nickname: '博士', channel_name: '官服', bound_at: '2026-01-01T00:00:00.000Z',
        last_imported_at: null, credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null,
      },
    }]} onLogout={vi.fn()} onPayload={onPayload} />)

    await user.click(screen.getByRole('button', { name: '清除凭据' }))

    await waitFor(() => expect(onPayload).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('森空岛凭据已清除')
    expect(screen.queryByRole('button', { name: '清除凭据' })).not.toBeInTheDocument()
    expect(screen.getByText(/需要再次导入时请重新授权相同 UID/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/user/data/credential/clear', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/me', expect.any(Object))
  })

  it('shows the accepted deletion deadline before the user leaves the signed-out session', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      scheduled_for: '2026-08-07T00:00:00.000Z',
      cancellation_email: 'queued',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } })))
    render(<SettingsSection profiles={[]} onLogout={onLogout} onPayload={vi.fn()} />)

    const email = screen.getByLabelText('确认邮箱')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('maxlength', '254')
    await user.type(email, 'user@example.test')
    await user.type(screen.getByLabelText('当前密码', { selector: '#settings-delete-password' }), 'password')
    await user.click(screen.getByRole('button', { name: '发起注销请求' }))

    expect(await screen.findByText('注销申请已受理')).toBeInTheDocument()
    expect(screen.getByText(/撤销邮件已进入投递队列/)).toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    expect(onLogout).toHaveBeenCalledOnce()
  })
})
