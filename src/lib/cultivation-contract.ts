export type CultivationTarget = {
  elite: number
  level: number
  skill: number
  skillLevel: number
  moduleId: string | null
  moduleLevel: number
  potential: number
}

export type CultivationCurrent = {
  elite: number
  level: number
  skillLevel: number | null
  masteries: Record<string, number>
  modules: Record<string, number>
  modulesKnown?: boolean
  potential: number
}

export type CultivationCandidate = {
  key: string
  operatorId: string
  name: string
  current: CultivationCurrent
  target: CultivationTarget
  skillId: string
  frequency: number
  fixedFrequency: number
  stageCount: number
  examples: number[]
  items: Record<string, number>
  warnings: string[]
  satisfied: boolean
}

type CultivationFarm = {
  stage: string
  sanity: number
  quantity: number
  days: number[]
}

export type CultivationPotion = {
  key: string
  name: string
  count: number
  sanity: number | null
  expiresAt: string | null
}

export type CultivationData = {
  candidates: CultivationCandidate[]
  inventory: Record<string, number>
  itemNames: Record<string, string>
  prices: Record<string, number>
  recipes: Record<string, { count: number; items: Record<string, number> }>
  farms: Record<string, CultivationFarm[]>
  potions: CultivationPotion[]
  stats: { homeworks: number; owned: number; missingOperators: number; incomplete: number }
  updatedAt: string
  importedAt: string
  pricingStatus: string
  warnings: string[]
}

export type CultivationOptions = {
  preference: 'coverage' | 'materials' | 'cost'
  dailySanity: number
  startDate: string
  days: number
  limit: number
  excluded: string[]
  potions: Record<string, number>
  allOpen: boolean
}
