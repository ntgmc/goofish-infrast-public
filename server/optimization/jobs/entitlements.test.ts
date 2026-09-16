import { describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../../src/lib/types'
import { limitPreviewOptimizeResult } from './entitlements'

describe('preview search statistics', () => {
  it.each([0, 123456])('preserves %s recorded states while removing advanced data', (count) => {
    const result: OptimizeResult = {
      author: '', title: '', description: '', buildingType: 243, planTimes: '',
      plans: [], raw_results: [], total_efficiency: 100, searched_state_count: count,
    }
    const projected = limitPreviewOptimizeResult(result)
    expect(projected.searched_state_count).toBe(count)
    expect(projected).not.toHaveProperty('total_efficiency')
    expect(projected.preview_limit).toBeDefined()
  })
})
