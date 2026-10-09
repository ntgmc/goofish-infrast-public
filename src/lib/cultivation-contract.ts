export type CultivationTarget = {
  elite: number
  level: number
  skill: number
  skillLevel: number
  moduleId: string | null
  moduleLevel: number | null
  potential: number
}

export type CultivationQuery = {
  scope: 'recent' | 'permanent' | 'history'
  days: number
  coverage: number
  stageId: string
  activity: string
  category: string
  profession: string
  rarity: number
  rarityGroup: 'high' | 'low' | 'all'
  search: string
  includeClosed: boolean
  includeAlternatives: boolean
  includeUncertain: boolean
}

export const defaultCultivationQuery: CultivationQuery = {
  scope: 'recent', days: 180, coverage: 0.8, stageId: '', activity: '', category: '', profession: '', rarity: 0, rarityGroup: 'high', search: '',
  includeClosed: false, includeAlternatives: true, includeUncertain: false,
}

export function matchesCultivationRarity(rarity: number, query: CultivationQuery) {
  return query.rarity ? rarity === query.rarity : query.rarityGroup === 'high' ? rarity >= 4 : query.rarityGroup === 'low' ? rarity <= 3 : true
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
  evidence?: {
    status: 'current' | 'limited' | 'historical' | 'insufficient'
    families: number
    recentFamilies: number
    recentStages: number
    usageShare: number
    coverage: number
    completeness: { training: number; skill: number; module: number }
  }
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
  recommendation?: {
    query: CultivationQuery
    families: number
    withoutActions: number
    stages: Array<{ id: string; name: string; activity: string; category: string }>
    professions: string[]
  }
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
  recommendation?: CultivationQuery
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
