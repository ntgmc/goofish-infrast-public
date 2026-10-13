import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../../src/lib/types'
import { applyScheduleGenerateEffects, limitPreviewOptimizeResult } from './entitlements'
import { setUsageEventStoreForTesting } from '../../handlers/usage-stats'
import { buildUsageStats } from '../../storage/usage-store'

afterEach(() => setUsageEventStoreForTesting(null))

it('records actual job completion and waiting time when an effect is delivered later', async () => {
  const set = vi.fn(async () => undefined)
  setUsageEventStoreForTesting({ set, list: async () => [], getStats: async (dates) => buildUsageStats([], dates) })
  await applyScheduleGenerateEffects(null, { status: 'success', reason_code: 'ok', profile_id: 'profile-1' },
    { submittedAt: 1_000, attemptStartedAt: 1_500, finishedAt: 2_000 }, 'job-1')
  expect(set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    created_at: '1970-01-01T00:00:02.000Z', duration_ms: 1_000, compute_duration_ms: 500,
  }))
})

describe('preview search statistics', () => {
  it.each([0, 123456])('preserves %s recorded states while removing advanced data', (count) => {
    const result: OptimizeResult = {
      author: '', title: '', description: '', buildingType: 243, planTimes: '',
      plans: [], raw_results: [], total_efficiency: 100, searched_state_count: count,
    }
    const projected = limitPreviewOptimizeResult(result)
    expect(projected.searched_state_count).toBe(count)
    expect(projected.total_efficiency).toBe(100)
    expect(projected.preview_limit).toBeDefined()
  })
})
