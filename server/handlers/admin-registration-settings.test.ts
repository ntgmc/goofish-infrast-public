import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn() }))
const settingsStore = vi.hoisted(() => ({
  getRegistrationSettings: vi.fn(),
  saveRegistrationSettings: vi.fn(),
}))
const brevoStore = vi.hoisted(() => ({ getBrevoEmailStats: vi.fn() }))
const quota = vi.hoisted(() => ({ refreshBrevoOfficialQuotaIfStale: vi.fn() }))

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/registration-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/registration-settings-store')>()
  return { ...actual, ...settingsStore }
})
vi.mock('../storage/brevo-email-store', () => brevoStore)
vi.mock('../brevo-quota', () => quota)

import handler from './admin-registration-settings'

const settings = {
  version: 4 as const,
  email_verification_required: true,
  invite_code_required: false,
  brevo_quota_action: 'pause_registration' as const,
  admin_invite_email_reserve: 20,
  password_reset_email_reserve: 10,
  updated_at: null,
}

describe('admin registration settings handler', () => {
  beforeEach(() => {
    auth.authenticateAdminRequest.mockReset().mockResolvedValue({ ok: true })
    settingsStore.getRegistrationSettings.mockReset().mockResolvedValue(settings)
    settingsStore.saveRegistrationSettings.mockReset().mockResolvedValue(settings)
    brevoStore.getBrevoEmailStats.mockReset().mockResolvedValue({ daily_limit: 300 })
    quota.refreshBrevoOfficialQuotaIfStale.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('returns stable cross-field validation issues', async () => {
    const response = await handler(jsonRequest({
      ...settings,
      admin_invite_email_reserve: 200,
      password_reset_email_reserve: 101,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: '注册设置无效。',
      code: 'invalid_registration_settings',
      issues: [{
        path: 'password_reset_email_reserve',
        message: '两类邮件预留总和不能超过 300。',
      }],
    })
    expect(settingsStore.saveRegistrationSettings).not.toHaveBeenCalled()
  })

  it.each([
    ['settings store', () => settingsStore.getRegistrationSettings.mockRejectedValueOnce(new Error('postgres password leaked'))],
    ['email statistics', () => brevoStore.getBrevoEmailStats.mockRejectedValueOnce(new Error('brevo token leaked'))],
  ])('returns a generic 500 when %s fails', async (_label, arrange) => {
    arrange()
    const response = await handler(new Request('http://localhost/api/admin/registration-settings'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toMatch(/postgres password|brevo token/)
  })

  it('does not classify save failures as validation errors', async () => {
    settingsStore.saveRegistrationSettings.mockRejectedValueOnce(new Error('connection detail leaked'))
    const response = await handler(jsonRequest(settings))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toContain('connection detail leaked')
  })
})

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/registration-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
