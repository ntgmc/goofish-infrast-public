import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGISTRATION_SETTINGS,
  normalizeRegistrationSettings,
  validateRegistrationSettingsPatch,
} from './registration-settings-store'

describe('registration settings', () => {
  it('requires email verification and keeps invite-only registration disabled by default', () => {
    expect(normalizeRegistrationSettings(null)).toEqual(DEFAULT_REGISTRATION_SETTINGS)
    expect(normalizeRegistrationSettings({ email_verification_required: 'false' })).toEqual(DEFAULT_REGISTRATION_SETTINGS)
  })

  it('preserves an explicit disabled setting', () => {
    expect(normalizeRegistrationSettings({
      email_verification_required: false,
      updated_at: '2026-07-19T00:00:00.000Z',
    })).toEqual({
      version: 5,
      email_verification_required: false,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'ses'],
      brevo_quota_action: 'pause_registration',
      admin_invite_email_reserve: 0,
      password_reset_email_reserve: 0,
      updated_at: '2026-07-19T00:00:00.000Z',
    })
  })

  it('normalizes invalid stored reserve totals without exceeding the daily limit', () => {
    expect(normalizeRegistrationSettings({
      admin_invite_email_reserve: 250,
      password_reset_email_reserve: 100,
    })).toMatchObject({
      admin_invite_email_reserve: 250,
      password_reset_email_reserve: 50,
    })
  })

  it('accepts both quota actions and requires the complete patch', () => {
    expect(validateRegistrationSettingsPatch({
      email_verification_required: false,
      invite_code_required: true,
      email_provider_priority: ['ses', 'brevo'],
      brevo_quota_action: 'allow_unverified_registration',
      admin_invite_email_reserve: 20,
      password_reset_email_reserve: 10,
    })).toEqual({
      email_verification_required: false,
      invite_code_required: true,
      email_provider_priority: ['ses', 'brevo'],
      brevo_quota_action: 'allow_unverified_registration',
      admin_invite_email_reserve: 20,
      password_reset_email_reserve: 10,
    })
    expect(() => validateRegistrationSettingsPatch({})).toThrow(/布尔值/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: false,
      email_provider_priority: ['brevo', 'ses'],
      brevo_quota_action: 'pause_registration',
      admin_invite_email_reserve: 0,
      password_reset_email_reserve: 0,
    })).toThrow(/仅邀请/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: false,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'ses'],
      admin_invite_email_reserve: 0,
      password_reset_email_reserve: 0,
    })).toThrow(/处理方式/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: true,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'ses'],
      brevo_quota_action: 'unknown',
      admin_invite_email_reserve: 0,
      password_reset_email_reserve: 0,
    })).toThrow(/处理方式/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: true,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'ses'],
      brevo_quota_action: 'pause_registration',
      admin_invite_email_reserve: 200,
      password_reset_email_reserve: 101,
    })).toThrow(/总和/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: true,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'ses'],
      brevo_quota_action: 'pause_registration',
      admin_invite_email_reserve: 1.5,
      password_reset_email_reserve: 0,
    })).toThrow(/整数/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: true,
      invite_code_required: false,
      email_provider_priority: ['brevo', 'brevo'],
      brevo_quota_action: 'pause_registration',
      admin_invite_email_reserve: 0,
      password_reset_email_reserve: 0,
    })).toThrow(/优先级/)
    expect(() => validateRegistrationSettingsPatch(null)).toThrow(/对象/)
  })
})
