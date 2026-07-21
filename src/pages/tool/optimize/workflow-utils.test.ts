import { describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../../lib/types'
import { normalizeUpgradeSuggestions } from './workflow-utils'

describe('normalizeUpgradeSuggestions', () => {
  it('restores persisted suggestions with ROI and apply-ready elite fields', () => {
    const persisted: NonNullable<OptimizeResult['upgrade_suggestions']> = [{
      type: 'single',
      id: 'char-1',
      name: '测试干员',
      current: 1,
      target: 2,
      gain: 12.4,
      roi: {
        efficiency_gain: 12.4,
        daily_sanity_gain: 4.2,
        payback_days: 3,
        payback_basis: 'missing_sanity',
      },
    }]

    const restored = normalizeUpgradeSuggestions(persisted)

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      type: 'single',
      id: 'char-1',
      current_elite: 1,
      target_elite: 2,
      gain: 12,
      roi: {
        daily_sanity_gain: 4.2,
        payback_days: 3,
      },
    })
  })

  it('sorts restored suggestions by gain and limits the result count', () => {
    const persisted: NonNullable<OptimizeResult['upgrade_suggestions']> = Array.from({ length: 22 }, (_, index) => ({
      type: 'single' as const,
      id: `char-${index}`,
      name: `干员 ${index}`,
      current: 0,
      target: 1,
      gain: index,
    }))

    const restored = normalizeUpgradeSuggestions(persisted)

    expect(restored).toHaveLength(20)
    expect(restored[0]?.gain).toBe(21)
    expect(restored[restored.length - 1]?.gain).toBe(2)
  })
})
