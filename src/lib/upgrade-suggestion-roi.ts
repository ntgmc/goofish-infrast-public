import type { UpgradeSuggestion } from './types'

export function getUpgradePaybackDays(suggestion: Pick<UpgradeSuggestion, 'roi' | 'training_cost'>): number | null {
  const cost = suggestion.training_cost
  const gain = suggestion.roi?.daily_sanity_gain
  const missing = cost?.missing.equivalent_sanity
  if (cost?.status !== 'available'
    || typeof missing !== 'number' || !Number.isFinite(missing) || missing < 0
    || typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) return null
  const days = missing / gain
  return Number.isFinite(days) ? days : null
}
