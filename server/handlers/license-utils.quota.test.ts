import { describe, expect, it } from 'vitest'
import {
  getCdkScheduleQuotaLimit,
  getCdkScenarioQuotaLimit,
  type LegacyProfileCdkRecord,
  type ProfileCdkDuration,
} from './license-utils'

describe('profile CDK schedule quotas', () => {
  it.each([
    ['month', 2],
    ['half_year', 4],
    ['year', 8],
    ['lifetime', null],
  ] as const)('limits %s cards to the configured successful main schedules', (duration, expected) => {
    expect(getCdkScheduleQuotaLimit(profileCdk(duration))).toBe(expected)
  })

  it('keeps legacy profile CDKs unlimited', () => {
    const record = profileCdk('lifetime')
    delete record.profile_duration
    expect(getCdkScheduleQuotaLimit(record)).toBeNull()
  })
})

describe('profile CDK scenario quotas', () => {
  it.each([
    ['month', 1],
    ['half_year', 3],
    ['year', 8],
    ['lifetime', null],
  ] as const)('limits %s cards to the configured successful comparisons', (duration, expected) => {
    expect(getCdkScenarioQuotaLimit(profileCdk(duration))).toBe(expected)
  })

  it('keeps legacy profile CDKs unlimited', () => {
    const record = profileCdk('lifetime')
    delete record.profile_duration
    expect(getCdkScenarioQuotaLimit(record)).toBeNull()
  })
})

function profileCdk(profileDuration: ProfileCdkDuration): LegacyProfileCdkRecord {
  return {
    version: 1,
    code_hash: 'a'.repeat(64),
    status: 'used',
    created_at: '2026-08-09T00:00:00.000Z',
    used_at: '2026-08-09T00:00:00.000Z',
    order_note: null,
    license_order_hash: null,
    operator_count: null,
    config_desc: null,
    permission: 'advanced',
    profile_duration: profileDuration,
  }
}
