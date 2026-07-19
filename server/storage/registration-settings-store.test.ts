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
      version: 1,
      email_verification_required: false,
      updated_at: '2026-07-19T00:00:00.000Z',
    })
  })

  it('accepts only a boolean email verification patch', () => {
    expect(validateRegistrationSettingsPatch({ email_verification_required: false })).toEqual({ email_verification_required: false })
    expect(() => validateRegistrationSettingsPatch({})).toThrow(/布尔值/)
    expect(() => validateRegistrationSettingsPatch({ email_verification_required: 'false' })).toThrow(/布尔值/)
    expect(() => validateRegistrationSettingsPatch(null)).toThrow(/对象/)
  })
})
