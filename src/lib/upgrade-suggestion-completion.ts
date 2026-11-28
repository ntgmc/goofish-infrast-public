import type { UpgradeSuggestion } from './types'

export function isUpgradeSuggestionCompleted(suggestion: UpgradeSuggestion): boolean {
  const targets = suggestion.type === 'single' ? [suggestion] : suggestion.ops ?? []
  const costs = suggestion.training_cost?.operators ?? []
  return targets.length > 0 && targets.every((target) => {
    const elite = target.target ?? target.target_elite
    const cost = costs.find((operator) => target.id ? operator.id === target.id : operator.name === target.name)
    return typeof elite === 'number' && cost !== undefined && cost.status !== 'unavailable'
      && cost.current_elite >= elite
  })
}
