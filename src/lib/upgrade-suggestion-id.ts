import type { UpgradeSuggestion } from './types'

export function getUpgradeSuggestionId(suggestion: UpgradeSuggestion, index: number): string {
  if (suggestion.suggestion_id) return suggestion.suggestion_id
  if (suggestion.type === 'single') {
    return `single:${suggestion.id || suggestion.name || index}:${suggestion.current ?? suggestion.current_elite ?? ''}:${suggestion.target ?? suggestion.target_elite ?? ''}`
  }
  const operators = (suggestion.ops ?? []).map((operator) => (
    `${operator.id || operator.name}:${operator.current ?? operator.current_elite ?? ''}:${operator.target ?? operator.target_elite ?? ''}`
  )).join('|')
  return `bundle:${operators || index}`
}
