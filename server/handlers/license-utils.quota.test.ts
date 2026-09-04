import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS } from '../../src/lib/config'
import {
  getCdkScenarioQuotaLimit,
  resolveConfigForPermission,
  resolveFreePreviewConfig,
  type LegacyProfileCdkRecord,
  type ProfileCdkDuration,
} from './license-utils'

describe('restricted profile presets', () => {
  it('accepts the 333 pure money preset', () => {
    const config = CONFIG_PRESETS['333-lmd']

    expect(resolveConfigForPermission('recommended', config)).toMatchObject({ ok: true })
    expect(resolveFreePreviewConfig(config)).toMatchObject({ ok: true })
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
