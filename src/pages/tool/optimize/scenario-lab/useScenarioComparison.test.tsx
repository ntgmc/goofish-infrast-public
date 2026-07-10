// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScenarioComparisonFactors } from '../../../../lib/scenario-comparison'
import type { LicenseConfig } from '../../../../lib/types'
import { useScenarioComparison } from './useScenarioComparison'

const PROFILE_A_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '153', splits: [{ pureGold: 2, battleRecord: 3 }] }],
  maaShiftHours: [6],
  includeRotation: false,
  droneStrategies: ['off'],
}

const PROFILE_B_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '333', splits: [{ pureGold: 1, battleRecord: 2 }] }],
  maaShiftHours: [12],
  includeRotation: true,
  droneStrategies: ['auto'],
}

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe('useScenarioComparison', () => {
  it('clears the previous account session and restores the next account factors', async () => {
    window.sessionStorage.setItem('maa:scenario-lab:profile-a', JSON.stringify({ factors: PROFILE_A_FACTORS }))
    window.sessionStorage.setItem('maa:scenario-lab:profile-b', JSON.stringify({ factors: PROFILE_B_FACTORS }))

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
    expect(window.sessionStorage.getItem('maa:scenario-lab:profile-a')).toBeNull()
  })
})
