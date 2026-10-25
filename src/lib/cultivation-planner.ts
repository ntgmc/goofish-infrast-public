import type { CultivationCandidate, CultivationData, CultivationOptions } from './cultivation-contract'
import { cultivatedCurrent, cultivationSatisfied } from './cultivation-target'

type Allocation = { missing: Record<string, number>; stock: Record<string, number>; sanity: number | null; knownSanity: number; exchanges: Array<{ item: string; count: number; currency: string; cost: number }> }

export function allocateCultivationMaterials(items: Record<string, number>, inventory: Record<string, number>, data: Pick<CultivationData, 'recipes' | 'prices'>): Allocation {
  const stock = { ...inventory }
  const missing: Record<string, number> = {}
  const exchanges: Allocation['exchanges'] = []
  const consume = (id: string, count: number, seen: Set<string>) => {
    const have = Math.min(count, stock[id] ?? 0)
    stock[id] = (stock[id] ?? 0) - have
    const shortage = count - have
    if (shortage <= 0) return
    if (id === '32001') {
      exchanges.push({ item: id, count: shortage, currency: '4006', cost: shortage * 90 })
      consume('4006', shortage * 90, new Set(seen).add(id))
      return
    }
    const recipe = data.recipes[id]
    // Two-way chip recipes only convert existing stock; recursively producing the input would cycle.
    if (recipe && !seen.has(id) && (recipe.count === 1 || Object.entries(recipe.items).every(([ingredient, amount]) => (stock[ingredient] ?? 0) >= amount * Math.ceil(shortage / recipe.count)))) {
      const batches = Math.ceil(shortage / recipe.count)
      stock[id] += recipe.count * batches - shortage
      for (const [ingredient, amount] of Object.entries(recipe.items)) consume(ingredient, amount * batches, new Set(seen).add(id))
    } else missing[id] = (missing[id] ?? 0) + shortage
  }
  // Reserve directly required materials before crafting higher tiers from shared stock.
  const shortages = Object.entries(items).map(([id, count]) => {
    const have = Math.min(count, stock[id] ?? 0)
    stock[id] = (stock[id] ?? 0) - have
    return [id, count - have] as const
  })
  for (const [id, count] of shortages) consume(id, count, new Set())
  const knownSanity = Object.entries(missing).reduce((sum, [id, count]) => sum + (data.prices[id] ?? 0) * count, 0)
  return { stock, missing, exchanges, knownSanity, sanity: Object.keys(missing).some((id) => data.prices[id] === undefined) ? null : knownSanity }
}

export function recommendCultivationTargets(data: CultivationData, options: CultivationOptions) {
  const excluded = new Set(options.excluded)
  let candidates = data.candidates.filter((row) => !row.satisfied && row.warnings.length === 0 && !excluded.has(row.operatorId) && (options.preference === 'community' ? row.source === 'community' : row.source !== 'community'))
  const selected: CultivationCandidate[] = []
  const fulfilledGroups = new Set<string>()
  const remainingDemand = (candidate: CultivationCandidate) => {
    if (!candidate.demandKeys) return candidate
    const keys = candidate.demandKeys.filter((key) => !fulfilledGroups.has(key))
    return { ...candidate, frequency: keys.length, weightedFrequency: keys.reduce((sum, key) => sum + (candidate.demandWeights?.[key] ?? 1), 0) }
  }
  while (candidates.length && selected.length < Math.max(1, Math.min(30, options.limit))) {
    const ranked = candidates.map(remainingDemand).filter((candidate) => candidate.source === 'community' || candidate.frequency > 0)
    if (!ranked.length) break
    const next = ranked.sort((a, b) => {
      const strength = options.preference === 'community'
        ? (b.communityScore ?? 0.5) - (a.communityScore ?? 0.5)
        : (b.weightedFrequency ?? b.frequency) * (1 + (b.communityScore ?? 0.5)) - (a.weightedFrequency ?? a.frequency) * (1 + (a.communityScore ?? 0.5))
      const adoption = options.preference === 'community' ? (b.communityRate ?? 0) - (a.communityRate ?? 0) : 0
      return strength || adoption || (b.weightedFrequency ?? b.frequency) - (a.weightedFrequency ?? a.frequency) || a.key.localeCompare(b.key)
    })[0]
    selected.push(next)
    const trained = cultivatedCurrent(next.current, next.target, next.skillId)
    for (const group of data.groups ?? []) {
      if (group.options.some((option) => option.operatorId === next.operatorId && cultivationSatisfied(trained, option.target, option.skillId))) fulfilledGroups.add(group.key)
    }
    candidates = candidates.filter((row) => row.operatorId !== next.operatorId)
  }
  return selected
}
