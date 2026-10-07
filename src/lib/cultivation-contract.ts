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
  moduleName?: string
  demandKeys?: string[]
  demandWeights?: Record<string, number>
  weightedFrequency?: number
  source?: 'homework' | 'community'
  communityRate?: number
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
  community?: { updatedAt: string | null; status: 'fresh' | 'stale' | 'unavailable'; operators: Record<string, CultivationStatistics> }
  specialItems?: CultivationSpecialItem[]
  specialItemsUpdatedAt?: string | null
  skillIcons?: Record<string, string>
  itemIcons?: Record<string, string>
  groups?: Array<{ key: string; options: Array<{ operatorId: string; target: CultivationTarget; skillId: string }> }>
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
  preference: 'coverage' | 'materials' | 'cost' | 'community'
  dailySanity: number
  startDate: string
  days: number
  limit: number
  excluded: string[]
  potions: Record<string, number>
  allOpen: boolean
}

export type CultivationStatistics = {
  owned: number
  sampleSize: number
  elite: number[]
  skills: number[][]
  modules: Record<string, number[]>
}

export type CultivationSpecialItem = {
  id: string
  name: string
  iconId: string
  kind: 'elite' | 'level' | 'mastery' | 'selector' | 'materials'
  count: number
  scope: string
  sourceUrl: string
  expiresAt: string | null
  available: boolean
  recommendations: Array<{
    key: string
    name: string
    operatorId?: string
    skill?: number
    owned?: boolean
    demand: number
    communityRate: number | null
    items: Record<string, number>
    warnings: string[]
  }>
}
