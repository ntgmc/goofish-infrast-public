import { describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../../lib/types'
import { getUpgradeSuggestionId } from '../../../lib/upgrade-suggestion-id'
import { buildUpgradeSuggestionEliteOverrides, normalizeUpgradeSuggestions } from './workflow-utils'

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

  it('preserves stable IDs and applies selected single and bundle suggestions', () => {
    const persisted: NonNullable<OptimizeResult['upgrade_suggestions']> = [{
      type: 'single',
      suggestion_id: 'upgrade-single',
      id: 'char-1',
      name: '干员 1',
      current: 0,
      target: 1,
      gain: 10,
    }, {
      type: 'bundle',
      suggestion_id: 'upgrade-bundle',
      gain: 20,
      ops: [{ id: 'char-2', name: '干员 2', current: 1, target: 2 }],
    }]
    const restored = normalizeUpgradeSuggestions(persisted)

    expect(restored.map((suggestion) => suggestion.suggestion_id)).toEqual(['upgrade-bundle', 'upgrade-single'])
    expect(buildUpgradeSuggestionEliteOverrides(
      restored,
      ['upgrade-bundle', 'upgrade-single'],
      { 'char-existing': 1 },
    )).toEqual({
      'char-existing': 1,
      'char-1': 1,
      'char-2': 2,
    })
  })

  it('keeps legacy bundle fallback IDs stable when suggestions are reordered', () => {
    const bundle = normalizeUpgradeSuggestions([{
      type: 'bundle',
      gain: 10,
      ops: [{ id: 'char-2', name: '干员 2', current: 1, target: 2 }],
    }])[0]

    expect(getUpgradeSuggestionId(bundle, 0)).toBe(getUpgradeSuggestionId(bundle, 8))
  })
})
