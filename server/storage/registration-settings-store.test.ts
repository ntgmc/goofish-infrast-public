import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGISTRATION_SETTINGS,
  normalizeRegistrationSettings,
  validateRegistrationSettingsPatch,
} from './registration-settings-store'

describe('registration settings', () => {
  it('requires email verification by default', () => {
    expect(normalizeRegistrationSettings(null)).toEqual(DEFAULT_REGISTRATION_SETTINGS)
    expect(normalizeRegistrationSettings({ email_verification_required: 'false' })).toEqual(DEFAULT_REGISTRATION_SETTINGS)
  })

  it('preserves an explicit disabled setting', () => {
    expect(normalizeRegistrationSettings({
      email_verification_required: false,
      updated_at: '2026-07-19T00:00:00.000Z',
    })).toEqual({
      version: 2,
      email_verification_required: false,
      brevo_quota_action: 'pause_registration',
      updated_at: '2026-07-19T00:00:00.000Z',
    })
  })

  it('accepts both quota actions and requires the complete patch', () => {
    expect(validateRegistrationSettingsPatch({
      email_verification_required: false,
      brevo_quota_action: 'allow_unverified_registration',
    })).toEqual({
      email_verification_required: false,
      brevo_quota_action: 'allow_unverified_registration',
    })
    expect(() => validateRegistrationSettingsPatch({})).toThrow(/布尔值/)
    expect(() => validateRegistrationSettingsPatch({ email_verification_required: false })).toThrow(/处理方式/)
    expect(() => validateRegistrationSettingsPatch({
      email_verification_required: true,
      brevo_quota_action: 'unknown',
    })).toThrow(/处理方式/)
    expect(() => validateRegistrationSettingsPatch(null)).toThrow(/对象/)
  })
})
