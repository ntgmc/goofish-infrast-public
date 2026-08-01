// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from '../../../../lib/api-client'
import type { ScenarioComparisonFactors } from '../../../../lib/scenario-comparison'
import type { LicenseConfig } from '../../../../lib/types'
import { useScenarioComparison } from './useScenarioComparison'

vi.mock('../../../../lib/api-client', () => ({ apiJson: vi.fn() }))

const PROFILE_A_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '153', plans: [{ trading: { lmd: 1, orundum: 0 }, manufacturing: { pureGold: 2, battleRecord: 3, originiumShard: 0 } }] }],
  maaSchedules: ['variable'],
  includeRotation: false,
  droneStrategies: ['off'],
}

const PROFILE_B_FACTORS: ScenarioComparisonFactors = {
  layouts: [{ layout: '333', plans: [{ trading: { lmd: 2, orundum: 1 }, manufacturing: { pureGold: 1, battleRecord: 1, originiumShard: 1 } }] }],
  maaSchedules: ['8x3'],
  includeRotation: true,
  droneStrategies: ['auto'],
}

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.mocked(apiJson).mockReset()
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
    expect(result.current.factors.maaSchedules).toEqual(['variable', '8x3'])
  })

  it('filters the retired two-shift MAA option from stored sessions', () => {
    window.sessionStorage.setItem('maa:scenario-lab:v2:profile-old-two-shift', JSON.stringify({
      factors: { ...PROFILE_A_FACTORS, maaSchedules: ['12x2'] },
    }))

    const { result } = renderHook(() => useScenarioComparison({
      profileId: 'profile-old-two-shift',
      operators: [],
      config: {} as LicenseConfig,
    }))

    expect(result.current.factors.maaSchedules).toEqual(['variable', '8x3'])
  })

  it('clears a corrupted deep session shape and restores safe defaults', () => {
    const key = 'maa:scenario-lab:v2:profile-corrupt'
    window.sessionStorage.setItem(key, JSON.stringify({
      factors: { ...PROFILE_A_FACTORS, layouts: 'broken', droneStrategies: { includes: true } },
      activeJobId: 123,
      result: { kind: 'scenario_comparison' },
    }))

    const { result } = renderHook(() => useScenarioComparison({
      profileId: 'profile-corrupt',
      operators: [],
      config: {} as LicenseConfig,
    }))

    expect(result.current.factors).toMatchObject({
      layouts: [{ layout: '243' }],
      maaSchedules: ['variable', '8x3'],
      droneStrategies: ['off', 'auto'],
    })
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })

  it('preserves the previous account session and restores the next account factors', async () => {
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
    expect(window.sessionStorage.getItem('maa:scenario-lab:v2:profile-a')).toContain('"layout":"153"')
  })

  it('keeps cancelled task progress visible without reporting it as an error', async () => {
    window.sessionStorage.setItem('maa:scenario-lab:v2:profile-cancelled', JSON.stringify({
      factors: PROFILE_A_FACTORS,
      activeJobId: 'scenario-cancelled',
    }))
    vi.mocked(apiJson).mockResolvedValue({
      id: 'scenario-cancelled',
      kind: 'scenario_comparison',
      source: 'scenario_comparison',
      status: 'cancelled',
      priority: { kind: 'analysis', label: '高级分析' },
      queuePosition: null,
      pollAfterMs: 1_500,
      timestamps: {
        submittedAt: '2026-07-10T00:00:00.000Z',
        finishedAt: '2026-07-10T00:00:05.000Z',
        nextAttemptAt: null,
        cancelRequestedAt: '2026-07-10T00:00:05.000Z',
      },
      estimate: {
        durationMs: 90_000,
        bucket: 'scenario_comparison',
        source: 'fallback_p95',
        sampleCount: 0,
        remainingMs: null,
        totalMs: null,
        phase: 'cancelled',
        updatedAt: '2026-07-10T00:00:05.000Z',
      },
      executionPhase: 'terminal',
      attemptCount: 0,
      failureCount: 0,
      cancellationRequested: true,
      canCancel: false,
      canRetry: true,
      error: {
        code: 'cancelled_by_user',
        message: '任务已由用户取消。',
        retryable: true,
        recoveryAction: 'retry',
        attemptCount: 0,
        supportReference: 'OPT-CANCEL',
      },
    } as never)

    const { result } = renderHook(() => useScenarioComparison({
      profileId: 'profile-cancelled',
      operators: [],
      config: {} as LicenseConfig,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.progress).toMatchObject({
      jobId: 'scenario-cancelled',
      estimatePhase: 'cancelled',
      executionPhase: 'terminal',
      cancellationRequested: true,
    })
  })

  it('reuses the pending idempotency key after an unknown submission outcome', async () => {
    vi.mocked(apiJson).mockRejectedValue(new TypeError('network lost'))
    const { result } = renderHook(() => useScenarioComparison({
      profileId: 'profile-pending',
      operators: [],
      config: {} as LicenseConfig,
    }))

    await act(async () => result.current.run())
    await act(async () => result.current.run())

    const first = new Headers(vi.mocked(apiJson).mock.calls[0]?.[1]?.headers).get('Idempotency-Key')
    const second = new Headers(vi.mocked(apiJson).mock.calls[1]?.[1]?.headers).get('Idempotency-Key')
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })
})
