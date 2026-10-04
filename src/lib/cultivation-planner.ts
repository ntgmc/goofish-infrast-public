import type { CultivationCandidate, CultivationData, CultivationOptions } from './cultivation-contract'
import { cultivatedCurrent, cultivationSatisfied } from './cultivation-target'

type Allocation = { missing: Record<string, number>; stock: Record<string, number>; sanity: number | null; knownSanity: number; exchanges: Array<{ item: string; count: number; currency: string; cost: number }> }
type FarmTask = { item: string; quantity: number; remaining: number; operator: string }

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

export function buildCultivationPlan(data: CultivationData, options: CultivationOptions) {
  let stock = { ...data.inventory }
  const excluded = new Set(options.excluded)
  let candidates = data.candidates.filter((row) => !row.satisfied && row.warnings.length === 0 && !excluded.has(row.operatorId) && (options.preference === 'community' ? row.source === 'community' : row.source !== 'community'))
  const selected: Array<{ candidate: CultivationCandidate; allocation: Allocation; estimatedDate: string | null }> = []
  const score = (candidate: CultivationCandidate, allocation: Allocation) => {
    const cost = allocation.sanity ?? Infinity
    if (options.preference === 'community') return [-(candidate.communityRate ?? 0), cost]
    if (options.preference === 'cost') return [cost, -candidate.frequency]
    if (options.preference === 'materials') return [Object.keys(allocation.missing).length === 0 ? 0 : 1, cost, -candidate.frequency]
    return [-candidate.frequency, cost]
  }
  const fulfilledGroups = new Set<string>()
  const frequency = (candidate: CultivationCandidate) => candidate.demandKeys
    ? candidate.demandKeys.filter((key) => !fulfilledGroups.has(key)).length : candidate.frequency
  while (candidates.length && selected.length < Math.max(1, Math.min(30, options.limit))) {
    const ranked = candidates.filter((candidate) => candidate.source === 'community' || frequency(candidate) > 0).map((candidate) => ({ candidate: { ...candidate, frequency: frequency(candidate) }, allocation: allocateCultivationMaterials(candidate.items, stock, data) }))
    if (!ranked.length) break
    ranked.sort((a, b) => {
      const left = score(a.candidate, a.allocation), right = score(b.candidate, b.allocation)
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
      }
      return a.candidate.key.localeCompare(b.candidate.key)
    })
    const next = ranked[0]
    selected.push({ ...next, estimatedDate: null })
    stock = next.allocation.stock
    const trained = cultivatedCurrent(next.candidate.current, next.candidate.target, next.candidate.skillId)
    for (const group of data.groups ?? []) {
      if (group.options.some((option) => option.operatorId === next.candidate.operatorId && cultivationSatisfied(trained, option.target, option.skillId))) fulfilledGroups.add(group.key)
    }
    candidates = candidates.filter((row) => row.operatorId !== next.candidate.operatorId)
  }
  const tasks: FarmTask[] = selected.flatMap(({ candidate, allocation }) => Object.entries(allocation.missing).map(([item, quantity]) => ({ item, quantity, remaining: quantity, operator: candidate.key })))
  const blocked = tasks.filter((task) => !data.farms[task.item]?.length)
  const potionStock = data.potions.map((potion) => ({ ...potion, remaining: Math.max(0, Math.min(potion.count, Math.floor(options.potions[potion.key] ?? 0))) }))
    .filter((potion) => potion.sanity !== null)
    .sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))
  const days: Array<{ date: string; budget: number; spent: number; potions: Array<{ name: string; count: number }>; farms: Array<{ item: string; stage: string; runs: number; sanity: number; expectedQuantity: number }> }> = []
  const totalMaterials: Record<string, number> = {}
  const missingMaterials: Record<string, number> = {}
  for (const row of selected) {
    for (const [id, count] of Object.entries(row.candidate.items)) totalMaterials[id] = (totalMaterials[id] ?? 0) + count
    for (const [id, count] of Object.entries(row.allocation.missing)) missingMaterials[id] = (missingMaterials[id] ?? 0) + count
  }
  const summary = { totalMaterials, missingMaterials, totalTrainingSanity: Object.keys(totalMaterials).some((id) => data.prices[id] === undefined) ? null : Object.entries(totalMaterials).reduce((sum, [id, count]) => sum + data.prices[id] * count, 0) }
  const start = Date.parse(`${options.startDate}T04:00:00+08:00`)
  if (!Number.isFinite(start) || !Number.isFinite(options.dailySanity) || options.dailySanity < 0) return { ...summary, selected, days, blocked, remaining: tasks, totalSanity: null }
  for (let index = 0; index < Math.max(1, Math.min(180, options.days)); index++) {
    const timestamp = start + index * 86400000
    const date = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10)
    const weekday = new Date(timestamp + 8 * 3600000).getUTCDay() || 7
    let budget = Math.min(2000, options.dailySanity)
    let spent = 0
    const usedPotions: Array<{ name: string; count: number }> = []
    const farms: (typeof days)[number]['farms'] = []
    const eligible = tasks.filter((task) => task.remaining > 1e-8 && data.farms[task.item]?.some((farm) => options.allOpen || farm.days.includes(weekday)))
    for (const task of eligible) {
      const farm = data.farms[task.item].filter((row) => options.allOpen || row.days.includes(weekday)).sort((a, b) => a.sanity / a.quantity - b.sanity / b.quantity)[0]
      const neededRuns = Math.ceil((task.remaining - 1e-8) / farm.quantity)
      for (const potion of potionStock) {
        if (!potion.sanity || !potion.remaining || (potion.expiresAt && Date.parse(potion.expiresAt) <= timestamp)) continue
        const endOfDay = timestamp + 86400000
        // Do not assume a timed potion remains usable throughout its expiry day.
        if (potion.expiresAt && Date.parse(potion.expiresAt) < endOfDay) continue
        const count = Math.min(potion.remaining, Math.max(0, Math.ceil((neededRuns * farm.sanity - (budget - spent)) / potion.sanity)))
        if (count > 0) {
          potion.remaining -= count
          budget += count * potion.sanity
          const prior = usedPotions.find((row) => row.name === potion.name)
          if (prior) prior.count += count
          else usedPotions.push({ name: potion.name, count })
        }
      }
      const runs = Math.min(neededRuns, Math.floor((budget - spent) / farm.sanity))
      if (runs > 0) {
        spent += runs * farm.sanity
        task.remaining = Math.max(0, task.remaining - runs * farm.quantity)
        const prior = farms.find((row) => row.item === task.item && row.stage === farm.stage)
        if (prior) { prior.runs += runs; prior.sanity += runs * farm.sanity; prior.expectedQuantity += runs * farm.quantity }
        else farms.push({ item: task.item, stage: farm.stage, runs, sanity: runs * farm.sanity, expectedQuantity: runs * farm.quantity })
      }
    }
    for (const row of selected) {
      if (!row.estimatedDate && tasks.filter((task) => task.operator === row.candidate.key).every((task) => task.remaining <= 1e-8)) row.estimatedDate = date
    }
    days.push({ date, budget, spent, potions: usedPotions, farms })
    if (tasks.every((task) => task.remaining <= 1e-8)) break
  }
  return { ...summary, selected, days, blocked, remaining: tasks.filter((task) => task.remaining > 1e-8), totalSanity: selected.some((row) => row.allocation.sanity === null) ? null : selected.reduce((sum, row) => sum + (row.allocation.sanity ?? 0), 0) }
}
