import levelData from '../data/training-level-data.json'

export type TrainingGoal = { rarity: number; currentElite: number; currentLevel: number; targetElite: number; targetLevel: number }
export type TrainingLevels = { maxLevel: number[][]; characterExpMap: number[][]; characterUpgradeCostMap: number[][]; evolveGoldCost: number[][] }
export type TrainingResources = { lmd: number; exp: number }

export function calculateTrainingCost(goal: TrainingGoal, levels: TrainingLevels = levelData) {
  const { rarity, currentElite, currentLevel, targetElite, targetLevel } = goal
  const maxima = levels.maxLevel[rarity - 1]
  if (!Object.values(goal).every(Number.isInteger) || !maxima || currentElite < 0 || targetElite < currentElite
    || !maxima[currentElite] || !maxima[targetElite] || currentLevel < 1 || currentLevel > maxima[currentElite]
    || targetLevel < 1 || targetLevel > maxima[targetElite] || currentElite === targetElite && targetLevel < currentLevel) {
    throw new Error('invalid_training_goal')
  }
  let exp = 0, upgradeLmd = 0, promotionLmd = 0
  for (let phase = currentElite; phase <= targetElite; phase++) {
    const start = phase === currentElite ? currentLevel : 1
    const end = phase === targetElite ? targetLevel : maxima[phase]
    for (let index = start - 1; index < end - 1; index++) {
      const experience = levels.characterExpMap[phase]?.[index]
      const cash = levels.characterUpgradeCostMap[phase]?.[index]
      if (![experience, cash].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('incomplete_training_levels')
      exp += experience
      upgradeLmd += cash
    }
    if (phase < targetElite) {
      const cash = levels.evolveGoldCost[rarity - 1]?.[phase]
      if (typeof cash !== 'number' || !Number.isFinite(cash) || cash < 0) throw new Error('incomplete_training_levels')
      promotionLmd += cash
    }
  }
  return { exp, upgradeLmd, promotionLmd, lmd: upgradeLmd + promotionLmd }
}

export function analyzeTrainingBalance(inventory: TrainingResources) {
  if (![inventory.lmd, inventory.exp].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('invalid_training_resources')
  const { lmd, exp } = inventory
  const focus: 'empty' | 'lmd' | 'exp' | 'balanced' = lmd === 0 && exp === 0 ? 'empty' : lmd * 10 < exp * 12 ? 'lmd' : lmd * 10 > exp * 14 ? 'exp' : 'balanced'
  const supplement = focus === 'lmd' ? Math.ceil(exp * 13 / 10 - lmd) : focus === 'exp' ? Math.ceil(lmd * 10 / 13 - exp) : 0
  return { focus, ratio: exp > 0 ? lmd / exp : null, supplement }
}

export function estimateTrainingRecovery(inventory: TrainingResources, income: TrainingResources | null, now = new Date()) {
  const { focus } = analyzeTrainingBalance(inventory)
  if (focus !== 'lmd' && focus !== 'exp') return null
  const daily = income ?? { lmd: 0, exp: 0 }
  if (![daily.lmd, daily.exp].every((value) => Number.isFinite(value) && value >= 0) || !Number.isFinite(now.getTime())) throw new Error('invalid_training_income')
  const stage = focus === 'lmd' ? 'CE-6' : 'LS-6'
  const gap = focus === 'lmd' ? inventory.exp * 1.3 - inventory.lmd : inventory.lmd - inventory.exp * 1.3
  const baseGain = focus === 'lmd' ? daily.lmd - daily.exp * 1.3 : daily.exp * 1.3 - daily.lmd
  // LS-6 also grants 432 LMD at three stars. Both stages cost 36 sanity per run.
  const farmGain = 240 / 36 * (focus === 'lmd' ? 10000 : 10000 * 1.3 - 432)
  // The CN game day changes at 04:00 UTC+8. Repeat its seven-day supply calendar.
  const weekday = new Date(now.getTime() + 4 * 3600000).getUTCDay()
  let progress = 0
  const week = Array.from({ length: 7 }, (_, index) => {
    const open = focus === 'exp' || [0, 2, 4, 6].includes((weekday + index) % 7)
    progress += baseGain + (open ? farmGain : 0)
    return progress
  })
  const peak = Math.max(...week)
  const weeklyGain = week[6]
  if (peak < gap && weeklyGain <= 0) return { stage, days: null }
  const weeks = peak >= gap ? 0 : Math.ceil((gap - peak) / weeklyGain)
  const day = week.findIndex((gain) => gain + weeks * weeklyGain >= gap - 1e-6)
  return { stage, days: weeks * 7 + day + 1 }
}
