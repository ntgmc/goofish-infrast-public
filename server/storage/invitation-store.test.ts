import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVITATION_SETTINGS,
  normalizeInvitationCode,
  normalizeInvitationSettings,
  validateInvitationSettingsPatch,
} from './invitation-store'

describe('invitation settings', () => {
  it('uses the launch defaults and keeps both recipient rules', () => {
    expect(normalizeInvitationSettings(null)).toEqual(DEFAULT_INVITATION_SETTINGS)
    expect(normalizeInvitationSettings({
      enabled: false,
      daily_inviter_reward_limit: 25,
      rewards: [
        { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 3, validity_days: 30 },
        { recipient: 'invitee', type: 'priority_compute_coupon', quantity: 2, validity_days: 7 },
      ],
    })).toMatchObject({
      enabled: false,
      daily_inviter_reward_limit: 25,
      rewards: [
        { recipient: 'inviter', quantity: 3, validity_days: 30 },
        { recipient: 'invitee', quantity: 2, validity_days: 7 },
      ],
    })
  })

  it('rejects duplicate, unknown and out-of-range reward definitions', () => {
    expect(() => validateInvitationSettingsPatch({ rewards: [
      { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 1, validity_days: 0 },
      { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 1, validity_days: 0 },
    ] })).toThrow(/不能重复/)
    expect(() => validateInvitationSettingsPatch({ rewards: [
      { recipient: 'inviter', type: 'unknown', quantity: 1, validity_days: 0 },
      { recipient: 'invitee', type: 'priority_compute_coupon', quantity: 0, validity_days: 0 },
    ] })).toThrow(/不支持/)
    expect(() => validateInvitationSettingsPatch({ daily_inviter_reward_limit: 0 })).toThrow(/1 到 1000/)
  })

  it('normalizes only valid Crockford invitation codes', () => {
    expect(normalizeInvitationCode(' 12ab34cd5e ')).toBe('12AB34CD5E')
    expect(normalizeInvitationCode('12IO34ABCD')).toBeNull()
    expect(normalizeInvitationCode('short')).toBeNull()
  })
})
