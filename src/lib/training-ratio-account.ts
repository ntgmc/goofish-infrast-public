import { calculateTrainingCost, type TrainingLevels, type TrainingResources } from './training-ratio'

export type TrainingSettings = { low: 'none' | 'max'; four: 'none' | 'practical' | 'max'; five: 'none' | 'practical' | 'max'; six: 'none' | 'practical' | 'max'; modules: 'none' | 'common' | 'all'; moduleLevel: number }
export const defaultTrainingSettings: TrainingSettings = { low: 'none', four: 'practical', five: 'practical', six: 'practical', modules: 'none', moduleLevel: 1 }
export type TrainingAccountData = {
  snapshotVersion: string
  importedAt: string
  inventory: TrainingResources
  levels: TrainingLevels
  operators: Array<{
    id: string; name: string; rarity: number; elite: number; level: number
    modules: Array<{ id: string; name: string; elite: number; level: number; current: number | null; costs: Array<number | null>; common: boolean | null }>
  }>
  warnings: string[]
}

export function accountTrainingRequirements(data: TrainingAccountData, settings: TrainingSettings) {
  let lmd = 0, exp = 0, moduleLmd = 0, operators = 0
  const modules: Array<{ operator: string; name: string; from: number; to: number; lmd: number }> = []
  const issues: Array<{ name: string; reason: 'levels' | 'modules' | 'costs' | 'common' }> = []
  for (const operator of data.operators) {
    const choice = settings[operator.rarity <= 3 ? 'low' : operator.rarity === 4 ? 'four' : operator.rarity === 5 ? 'five' : 'six']
    if (choice === 'none') continue
    const maxima = data.levels.maxLevel[operator.rarity - 1]
    let elite = maxima?.length - 1
    let level = choice === 'max' || operator.rarity <= 3 ? maxima?.[elite] : [40, 50, 60][operator.rarity - 4]
    let cash = 0
    let needsModule = false
    for (const module of settings.modules === 'none' ? [] : operator.modules) {
      if (module.current !== null && module.current >= settings.moduleLevel) continue
      if (settings.modules === 'common' && module.common === null) { issues.push({ name: operator.name, reason: 'common' }); continue }
      if (settings.modules === 'common' && !module.common) continue
      if (module.current === null) { issues.push({ name: operator.name, reason: 'modules' }); continue }
      if (module.elite > elite) { elite = module.elite; level = module.level }
      else if (module.elite === elite) level = Math.max(level, module.level)
      const costs = module.costs.slice(module.current, settings.moduleLevel)
      if (costs.length !== settings.moduleLevel - module.current || costs.some((cost) => cost === null)) { issues.push({ name: operator.name, reason: 'costs' }); continue }
      const cost = costs.reduce<number>((sum, value) => sum + value!, 0)
      cash += cost
      needsModule = true
      modules.push({ operator: operator.name, name: module.name, from: module.current, to: settings.moduleLevel, lmd: cost })
    }
    if (operator.elite > elite || operator.elite === elite && operator.level > level) { elite = operator.elite; level = operator.level }
    try {
      const cost = calculateTrainingCost({ rarity: operator.rarity, currentElite: operator.elite, currentLevel: operator.level, targetElite: elite, targetLevel: level }, data.levels)
      lmd += cost.lmd + cash; exp += cost.exp; moduleLmd += cash
      if (cost.lmd || cost.exp || needsModule) operators++
    } catch { issues.push({ name: operator.name, reason: 'levels' }) }
  }
  return { lmd, exp, moduleLmd, operators, modules, issues }
}

export function analyzeAccountTraining(inventory: TrainingResources, required: TrainingResources) {
  if (![inventory.lmd, inventory.exp, required.lmd, required.exp].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('invalid_training_resources')
  const missing = { lmd: Math.max(0, required.lmd - inventory.lmd), exp: Math.max(0, required.exp - inventory.exp) }
  const focus: 'ready' | 'lmd' | 'exp' | 'both' = !missing.lmd && !missing.exp ? 'ready' : !missing.exp ? 'lmd' : !missing.lmd ? 'exp'
    : inventory.lmd * required.exp < inventory.exp * required.lmd ? 'lmd'
      : inventory.lmd * required.exp > inventory.exp * required.lmd ? 'exp' : 'both'
  return { focus, missing, ratio: required.exp ? required.lmd / required.exp : null }
}

export function estimateAccountTrainingDays(inventory: TrainingResources, required: TrainingResources, income: TrainingResources | null, now = new Date()) {
  const { missing } = analyzeAccountTraining(inventory, required)
  const daily = income ?? { lmd: 0, exp: 0 }
  if (![daily.lmd, daily.exp].every((value) => Number.isFinite(value) && value >= 0) || !Number.isFinite(now.getTime())) throw new Error('invalid_training_income')
  if (!missing.lmd && !missing.exp) return 0
  const weekday = new Date(now.getTime() + 4 * 3600000).getUTCDay()
  let days = 0, open = 0
  // Check each day: base EXP can replace LS-6 runs and remove their incidental cash, so feasibility is not monotonic.
  while (true) {
    if ([0, 2, 4, 6].includes((weekday + days) % 7)) open++
    days++
    const expRuns = Math.max(0, missing.exp - daily.exp * days) / 10000
    const lmdRuns = Math.max(0, missing.lmd - daily.lmd * days - expRuns * 432) / 10000
    if (expRuns + lmdRuns <= days * 240 / 36 + 1e-9 && lmdRuns <= open * 240 / 36 + 1e-9) return days
  }
}
