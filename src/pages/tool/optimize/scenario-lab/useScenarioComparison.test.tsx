// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScenarioComparisonFactors } from '../../../../lib/scenario-comparison'
import type { LicenseConfig } from '../../../../lib/types'
import { useScenarioComparison } from './useScenarioComparison'

const PROFILE_A_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '153', plans: [{ trading: { lmd: 1, orundum: 0 }, manufacturing: { pureGold: 2, battleRecord: 3, originiumShard: 0 } }] }],
  maaSchedules: ['variable'],
  includeRotation: false,
  droneStrategies: ['off'],
}

const PROFILE_B_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '333', plans: [{ trading: { lmd: 2, orundum: 1 }, manufacturing: { pureGold: 1, battleRecord: 1, originiumShard: 1 } }] }],
  maaSchedules: ['12x2'],
  includeRotation: true,
  droneStrategies: ['auto'],
}

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe('useScenarioComparison', () => {
  it('ignores the legacy unversioned session shape', () => {
    window.sessionStorage.setItem('maa:scenario-lab:profile-legacy', JSON.stringify({
      factors: { layouts: [], maaShiftHours: [6], includeRotation: false, droneStrategies: ['off'] },
    }))
    const { result } = renderHook(() => useScenarioComparison({
      profileId: 'profile-legacy',
      operators: [],
      config: {} as LicenseConfig,
    }))
    expect(result.current.factors.maaSchedules).toEqual(['variable', '8x3', '12x2'])
  })

  it('clears the previous account session and restores the next account factors', async () => {
    window.sessionStorage.setItem('maa:scenario-lab:v2:profile-a', JSON.stringify({ factors: PROFILE_A_FACTORS }))
    window.sessionStorage.setItem('maa:scenario-lab:v2:profile-b', JSON.stringify({ factors: PROFILE_B_FACTORS }))

    const { result, rerender } = renderHook(
      ({ profileId }) => useScenarioComparison({
        profileId,
        operators: [],
        config: {} as LicenseConfig,
      }),
      { initialProps: { profileId: 'profile-a' } },
    )

    expect(result.current.factors).toEqual(PROFILE_A_FACTORS)
    rerender({ profileId: 'profile-b' })

    await waitFor(() => expect(result.current.factors).toEqual(PROFILE_B_FACTORS))
    expect(window.sessionStorage.getItem('maa:scenario-lab:v2:profile-a')).toBeNull()
  })
})
