import { describe, expect, it } from 'vitest'
import type { LicenseConfig, OptimizeResult, WorkspaceResultHistoryItem, WorkspaceResultHistorySummary } from '../../../lib/types'
import { getUpgradeSuggestionId } from '../../../lib/upgrade-suggestion-id'
import { normalizeUpgradeSuggestions, resolveLatestHistoryConfig } from './workflow-utils'

describe('resolveLatestHistoryConfig', () => {
  it('returns null when the workspace has no result history', () => {
    expect(resolveLatestHistoryConfig(null, null)).toBeNull()
  })

  it('returns history config only when the selected and latest result IDs match', () => {
    const config = { layout: '243' } as LicenseConfig
    const historyItem = { id: 'result-1', config } as WorkspaceResultHistoryItem
    const latestResult = { id: 'result-1' } as WorkspaceResultHistorySummary

    expect(resolveLatestHistoryConfig(historyItem, latestResult)).toBe(config)
    expect(resolveLatestHistoryConfig(historyItem, { ...latestResult, id: 'result-2' })).toBeNull()
  })
})

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

  it('preserves stable IDs for single and bundle suggestions', () => {
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
