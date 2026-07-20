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
    by_purpose: { email_verification: 8, password_reset: 2, account_deletion_cancellation: 1, account_deletion_receipt: 1 },
  },
  days: [{
    date: '2026-07-21', sent_count: 12, reserved_count: 1, uncertain_count: 0, failed_count: 2,
    local_quota_used_count: 13, quota_used_count: 20, remaining_count: 280, limit_reached: false,
    by_purpose: { email_verification: 8, password_reset: 2, account_deletion_cancellation: 1, account_deletion_receipt: 1 },
  }],
}

describe('RegistrationSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockResolvedValue({
      settings: { version: 2, email_verification_required: true, brevo_quota_action: 'pause_registration', updated_at: null },
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
    expect(toggle).toBeChecked()
    expect(screen.getByText('12 / 300')).toBeInTheDocument()
    expect(screen.getByText('官方剩余额度')).toBeInTheDocument()
    expect(screen.getByText(/官方同步状态/)).toHaveTextContent('已同步')
    expect(screen.getByText('2026-07-21')).toBeInTheDocument()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '保存注册设置' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/registration-settings', expect.objectContaining({
      method: 'PUT',
      json: { email_verification_required: false, brevo_quota_action: 'pause_registration' },
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('注册设置已保存')
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
      json: { email_verification_required: true, brevo_quota_action: 'allow_unverified_registration' },
    })))
  })
})
