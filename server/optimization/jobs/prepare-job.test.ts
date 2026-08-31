import { describe, expect, it } from 'vitest'
import type { CdkRecord, ProfileCdkDuration } from '../../handlers/license-utils'
import { getScenarioComparisonQueuePriority, includesCdkIncrementalRecompute } from './prepare-job'

describe('CDK incremental recompute entitlement', () => {
  it.each(['month', 'half_year', 'year', 'lifetime'] as const)('includes recompute for %s cards', (duration) => {
    expect(includesCdkIncrementalRecompute(profileCdk(duration))).toBe(true)
  })

  it('does not apply to balance CDKs', () => {
    expect(includesCdkIncrementalRecompute({ cdk_type: 'balance' } as CdkRecord)).toBe(false)
  })
})

describe('scenario comparison queue priority', () => {
  it('uses standard queue weight for the free advanced preview trial', () => {
    expect(getScenarioComparisonQueuePriority(true, true)).toEqual({
      kind: 'standard',
      value: 0,
    })
  })

  it('keeps analysis queue weight for non-preview entitled profiles', () => {
    expect(getScenarioComparisonQueuePriority(false, false)).toEqual({
      kind: 'analysis',
      value: 5,
    })
    expect(getScenarioComparisonQueuePriority(false, true)).toEqual({
      kind: 'analysis',
      value: 5,
    })
  })
})

function profileCdk(profileDuration: ProfileCdkDuration): CdkRecord {
  return { cdk_type: 'profile', profile_duration: profileDuration } as CdkRecord
}
