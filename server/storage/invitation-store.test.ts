import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVITATION_SETTINGS,
  normalizeInvitationCode,
  normalizeInvitationSettings,
  validateInvitationSettingsPatch,
} from './invitation-store'

describe('invitation settings', () => {
  it('uses V2 defaults and migrates legacy priority coupon rules', () => {
    expect(normalizeInvitationSettings(null)).toEqual(DEFAULT_INVITATION_SETTINGS)
    expect(normalizeInvitationSettings({
      version: 1,
      enabled: false,
      daily_inviter_reward_limit: 25,
      rewards: [
        { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 3, validity_days: 30 },
        { recipient: 'invitee', type: 'priority_compute_coupon', quantity: 2, validity_days: 0 },
      ],
    })).toMatchObject({
      version: 2,
      enabled: false,
      daily_inviter_reward_limit: 25,
      rewards: [
        { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 3, expiry: { mode: 'relative_days', days: 30 } },
        { recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 2, expiry: { mode: 'never' } },
      ],
    })
  })

  it('accepts multi-item and single-sided V2 reward combinations', () => {
    expect(validateInvitationSettingsPatch({ rewards: [
      { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 2, expiry: { mode: 'never' }, gift_pack_version_id: null },
      { recipient: 'inviter', item_code: 'newcomer_supply_pack', quantity: 1, expiry: { mode: 'relative_days', days: 30 }, gift_pack_version_id: 'pack-v1' },
    ] })).toMatchObject({ rewards: [
      { item_code: 'priority_compute_coupon', quantity: 2, expiry: { mode: 'never' } },
      { item_code: 'newcomer_supply_pack', quantity: 1, expiry: { mode: 'relative_days', days: 30 } },
    ] })
  })

  it('rejects duplicates and out-of-range reward definitions', () => {
    expect(() => validateInvitationSettingsPatch({ rewards: [
      { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
      { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
    ] })).toThrow(/不能重复/)
    expect(() => validateInvitationSettingsPatch({ rewards: [
      { recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 0, expiry: { mode: 'never' } },
    ] })).toThrow(/1 到 10000/)
    expect(() => validateInvitationSettingsPatch({ rewards: [
      { recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'relative_days', days: 0 } },
    ] })).toThrow(/有效期/)
    expect(() => validateInvitationSettingsPatch({ daily_inviter_reward_limit: 0 })).toThrow(/1 到 1000/)
  })

  it('normalizes only valid Crockford invitation codes', () => {
    expect(normalizeInvitationCode(' 12ab34cd5e ')).toBe('12AB34CD5E')
    expect(normalizeInvitationCode('12IO34ABCD')).toBeNull()
    expect(normalizeInvitationCode('short')).toBeNull()
  })
})
