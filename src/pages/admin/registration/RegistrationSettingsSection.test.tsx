// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import RegistrationSettingsSection from './RegistrationSettingsSection'

const emailStats = {
  timezone: 'UTC',
  daily_limit: 300,
  official_quota: {
    status: 'fresh', reported_remaining_count: 280, reported_used_count: 20,
    external_used_offset: 7, synced_at: '2026-07-21T12:00:00.000Z', last_attempt_at: '2026-07-21T12:00:00.000Z',
  },
  today: {
    date: '2026-07-21', sent_count: 12, reserved_count: 1, uncertain_count: 0, failed_count: 2,
    local_quota_used_count: 13, quota_used_count: 20, remaining_count: 280, limit_reached: false,
    by_purpose: { email_verification: 8, admin_invite_verification: 0, password_reset: 2, account_deletion_cancellation: 1, account_deletion_receipt: 1 },
  },
  days: [{
    date: '2026-07-21', sent_count: 12, reserved_count: 1, uncertain_count: 0, failed_count: 2,
    local_quota_used_count: 13, quota_used_count: 20, remaining_count: 280, limit_reached: false,
    by_purpose: { email_verification: 8, admin_invite_verification: 0, password_reset: 2, account_deletion_cancellation: 1, account_deletion_receipt: 1 },
  }],
}

describe('RegistrationSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockImplementation(async (url: string) => url.startsWith('/api/admin/registration-invitations')
      ? { invitations: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } }
      : {
          settings: {
            version: 4,
            email_verification_required: true,
            invite_code_required: false,
            brevo_quota_action: 'pause_registration',
            admin_invite_email_reserve: 20,
            password_reset_email_reserve: 10,
            updated_at: null,
          },
          email_stats: emailStats,
        })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads the default-on setting and saves an explicit disabled value', async () => {
    const user = userEvent.setup()
    render(<RegistrationSettingsSection />)
    const toggle = await screen.findByRole('checkbox', { name: '注册时要求验证邮箱' })
    const inviteToggle = screen.getByRole('checkbox', { name: '仅邀请可注册' })
    expect(toggle).toBeChecked()
    expect(inviteToggle).not.toBeChecked()
    expect(screen.getByText('12 / 300')).toBeInTheDocument()
    expect(screen.getByText('官方剩余额度')).toBeInTheDocument()
    expect(screen.getByText(/官方同步状态/)).toHaveTextContent('已同步')
    expect(screen.getByText('2026-07-21')).toBeInTheDocument()
    await user.click(toggle)
    await user.click(inviteToggle)
    await user.click(screen.getByRole('button', { name: '保存注册设置' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/registration-settings', expect.objectContaining({
      method: 'PUT',
      json: {
        email_verification_required: false,
        invite_code_required: true,
        brevo_quota_action: 'pause_registration',
        admin_invite_email_reserve: 20,
        password_reset_email_reserve: 10,
      },
    })))
    expect(await screen.findByText(/注册设置已保存/)).toBeInTheDocument()
  })

  it('saves the allow-unverified strategy and shows its security warning', async () => {
    const user = userEvent.setup()
    render(<RegistrationSettingsSection />)
    const option = await screen.findByRole('radio', { name: /允许免验证注册/ })
    await user.click(option)
    expect(screen.getByRole('note')).toHaveTextContent('无法确认新用户是否拥有')
    await user.click(screen.getByRole('button', { name: '保存注册设置' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/registration-settings', expect.objectContaining({
      method: 'PUT',
      json: {
        email_verification_required: true,
        invite_code_required: false,
        brevo_quota_action: 'allow_unverified_registration',
        admin_invite_email_reserve: 20,
        password_reset_email_reserve: 10,
      },
    })))
  })

  it('blocks reserve totals above the daily limit before sending the update', async () => {
    const user = userEvent.setup()
    render(<RegistrationSettingsSection />)
    const adminReserve = await screen.findByLabelText('管理员邀请验证预留')
    await user.clear(adminReserve)
    await user.type(adminReserve, '295')
    await user.click(screen.getByRole('button', { name: '保存注册设置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('两类邮件预留总和不能超过 300')
    expect(adminApiJson.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
  })

  it('does not render editable controls until the first load succeeds', async () => {
    let settingsAttempts = 0
    adminApiJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/registration-invitations')) {
        return { invitations: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } }
      }
      settingsAttempts += 1
      if (settingsAttempts === 1) throw new Error('注册设置加载失败')
      return {
        settings: {
          version: 4,
          email_verification_required: true,
          invite_code_required: false,
          brevo_quota_action: 'pause_registration',
          admin_invite_email_reserve: 20,
          password_reset_email_reserve: 10,
          updated_at: null,
        },
        email_stats: emailStats,
      }
    })
    const user = userEvent.setup()
    render(<RegistrationSettingsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('注册设置加载失败')
    expect(screen.queryByRole('button', { name: '保存注册设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '注册时要求验证邮箱' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新载入' }))
    expect(await screen.findByRole('button', { name: '保存注册设置' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '注册时要求验证邮箱' })).toBeChecked()
  })
})
