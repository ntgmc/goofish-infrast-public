import levelData from './training-level-data.json'
import type { LicenseOperator, UpgradeTrainingCost } from '../../src/lib/types'
import { decryptSklandCredential, SklandClient } from './skland-client'

const YITULIU_STAGE_RESULT_URL = 'https://backend.yituliu.cn/stage/result?expCoefficient=0.633&sampleSize=300'
const YITULIU_CACHE_TTL_MS = 15 * 60 * 1000
const FIXED_SANITY_PER_LMD_OR_EXP = 36 / 10000
const EXP_ITEM_VALUES: Record<string, number> = {
  '2001': 200,
  '2002': 400,
  '2003': 1000,
  '2004': 2000,
}

type LevelData = {
  maxLevel: number[][]
  characterExpMap: number[][]
  characterUpgradeCostMap: number[][]
  evolveGoldCost: number[][]
}

type UpgradeSuggestionLike = Record<string, unknown>

type TrainingCostParams = {
  suggestions: UpgradeSuggestionLike[]
  operators: LicenseOperator[]
  encryptedCred?: string | null
  uid?: string | null
}

type MaterialAmount = {
  id: string
  name: string
  count: number
  rarity?: number
  sortId?: number
  equivalent_sanity?: number | null
}

type CostBucket = {
  cash: number
  exp: number
  materials: MaterialAmount[]
  equivalent_sanity: number | null
}

type OperatorCost = {
  id: string
  name: string
  current_elite: number
  target_elite: number
  current_level: number
  target_level: number
  totals: CostBucket
  missing: CostBucket
  warnings: string[]
}

type CostTarget = {
  id: string
  name: string
  currentElite: number
  targetElite: number
}

type CultivateContext = {
  client: SklandClient
  calInfo: Record<string, unknown>
  calPlayer: Record<string, unknown>
  itemMeta: Record<string, unknown>
  playerItems: InventoryItem[]
  playerCharacters: Record<string, unknown>[]
}

type InventoryItem = {
  id: string
  count: number
}

type PricingState = {
  status: 'ok' | 'unavailable'
  prices: Map<string, number>
}

let yituliuCache: { expiresAt: number; state: PricingState } | null = null

export async function attachTrainingCostsToUpgradeSuggestions({
  suggestions,
  operators,
  encryptedCred,
  uid,
}: TrainingCostParams): Promise<UpgradeSuggestionLike[]> {
  if (suggestions.length === 0) return suggestions

  if (!encryptedCred || !uid) {
    return suggestions.map((suggestion) => ({
      ...suggestion,
      training_cost: createUnavailableCost('当前档案未绑定森空岛，无法读取养成库存。'),
    }))
  }

  let context: CultivateContext
  try {
    const cred = decryptSklandCredential(encryptedCred)
    const client = new SklandClient(cred)
    const [calInfo, calPlayer] = await Promise.all([
      client.getCultivateInfo(),
      client.getCultivatePlayer(uid),
    ])
    context = createCultivateContext(client, calInfo, calPlayer)
  } catch {
    return suggestions.map((suggestion) => ({
      ...suggestion,
      training_cost: createUnavailableCost('森空岛养成数据暂不可用，已保留练度建议。'),
    }))
  }

  const pricing = await getYituliuPricing()
  const characterCostCache = new Map<string, unknown>()

  return Promise.all(suggestions.map(async (suggestion) => {
    try {
      const cost = await calculateSuggestionTrainingCost(
        suggestion,
        operators,
        context,
        pricing,
        characterCostCache,
      )
      return { ...suggestion, training_cost: cost }
    } catch {
      return {
        ...suggestion,
        training_cost: createUnavailableCost('该建议的材料成本暂时无法计算。'),
      }
    }
  }))
}

export function calculateEliteTrainingCostForTest(params: {
  target: CostTarget
  operators: LicenseOperator[]
  calInfo: unknown
  calPlayer: unknown
  characterCost: unknown
  pricing?: PricingState
}): UpgradeTrainingCost {
  const context = createCultivateContext({} as SklandClient, params.calInfo, params.calPlayer)
  const operator = resolveOperator(params.target, params.operators)
  if (!operator) throw new Error('operator not found')
  const playerCharacter = findPlayerCharacter(context.playerCharacters, params.target.id)
  const operatorCost = calculateOperatorCost(
    params.target,
    operator,
    playerCharacter,
    normalizeCharacterCost(params.characterCost, params.target.id),
    context,
    params.pricing ?? { status: 'unavailable', prices: new Map() },
  )
  return aggregateOperatorCosts([operatorCost], params.pricing ?? { status: 'unavailable', prices: new Map() })
}

async function calculateSuggestionTrainingCost(
  suggestion: UpgradeSuggestionLike,
  operators: LicenseOperator[],
  context: CultivateContext,
  pricing: PricingState,
  characterCostCache: Map<string, unknown>,
): Promise<UpgradeTrainingCost> {
  const targets = getSuggestionTargets(suggestion)
  if (targets.length === 0) return createUnavailableCost('练度建议缺少目标干员。')

  const operatorCosts: OperatorCost[] = []
  for (const target of targets) {
    const operator = resolveOperator(target, operators)
    if (!operator) {
      operatorCosts.push(createOperatorUnavailableCost(target, '当前工作区未找到该干员。'))
      continue
    }
    const resolvedTarget = {
      ...target,
      id: target.id || operator.id,
      name: target.name || operator.name,
    }

    let characterCost = characterCostCache.get(resolvedTarget.id)
    if (!characterCost) {
      characterCost = await context.client.getCultivateCharacter(resolvedTarget.id)
      characterCostCache.set(resolvedTarget.id, characterCost)
    }

    operatorCosts.push(calculateOperatorCost(
      resolvedTarget,
      operator,
      findPlayerCharacter(context.playerCharacters, resolvedTarget.id),
      normalizeCharacterCost(characterCost, resolvedTarget.id),
      context,
      pricing,
    ))
  }

  return aggregateOperatorCosts(operatorCosts, pricing)
}

function calculateOperatorCost(
  target: CostTarget,
  operator: LicenseOperator,
  playerCharacter: Record<string, unknown> | null,
  characterCost: Record<string, unknown>,
  context: CultivateContext,
  pricing: PricingState,
): OperatorCost {
  const rarity = normalizeRarity(numberValue(operator.rarity))
  const currentElite = numberValue(playerCharacter?.evolvePhase) ?? numberValue(operator.elite) ?? target.currentElite
  const currentLevel = Math.max(1, numberValue(playerCharacter?.level) ?? numberValue(operator.level) ?? 1)
  const targetElite = Math.max(currentElite, target.targetElite)
  const targetLevel = targetElite > currentElite ? 1 : currentLevel
  const warnings: string[] = []

  const totals = emptyBucket()
  if (rarity === null) {
    warnings.push('干员稀有度缺失或无效，请重新导入森空岛数据。')
    return {
      id: target.id,
      name: target.name,
      current_elite: currentElite,
      target_elite: targetElite,
      current_level: currentLevel,
      target_level: targetLevel,
      totals,
      missing: emptyBucket(),
      warnings,
    }
  }

  const maxLevels = (LEVEL.maxLevel[rarity] ?? []) as number[]
  const maxEvolve = maxLevels.length - 1
  if (targetElite > maxEvolve) {
    warnings.push(`目标精英阶段超过该干员上限 E${maxEvolve}。`)
    return {
      id: target.id,
      name: target.name,
      current_elite: currentElite,
      target_elite: targetElite,
      current_level: currentLevel,
      target_level: targetLevel,
      totals,
      missing: emptyBucket(),
      warnings,
    }
  }

  for (let phase = currentElite, level = currentLevel; phase <= targetElite; phase += 1) {
    while (phase < targetElite && level < (maxLevels[phase] ?? level)) {
      totals.exp += positiveArrayValue(LEVEL.characterExpMap[phase], level - 1)
      totals.cash += positiveArrayValue(LEVEL.characterUpgradeCostMap[phase], level - 1)
      level += 1
    }
    while (phase === targetElite && level < targetLevel) {
      totals.exp += positiveArrayValue(LEVEL.characterExpMap[phase], level - 1)
      totals.cash += positiveArrayValue(LEVEL.characterUpgradeCostMap[phase], level - 1)
      level += 1
    }
    level = 1
  }

  const evolveCosts = Array.isArray(characterCost.evolvePhaseCost) ? characterCost.evolvePhaseCost : []
  if (targetElite > currentElite && evolveCosts.length === 0) {
    warnings.push('森空岛未返回该干员晋升材料明细，仅能展示等级与龙门币/经验成本。')
  }
  for (let phase = currentElite; phase < targetElite; phase += 1) {
    totals.cash += positiveArrayValue(LEVEL.evolveGoldCost[rarity], phase)
    const phaseCost = evolveCosts[phase]
    if (!isRecord(phaseCost) || !Array.isArray(phaseCost.items)) continue
    mergeMaterials(totals.materials, phaseCost.items, context.itemMeta)
  }

  totals.equivalent_sanity = calculateBucketSanity(totals, pricing).value
  const missing = calculateMissingBucket(totals, context.playerItems, pricing)

  return {
    id: target.id,
    name: target.name || String(operator.name),
    current_elite: currentElite,
    target_elite: targetElite,
    current_level: currentLevel,
    target_level: targetLevel,
    totals,
    missing,
    warnings,
  }
}

function aggregateOperatorCosts(operatorCosts: OperatorCost[], pricing: PricingState): UpgradeTrainingCost {
  const totals = emptyBucket()
  const missing = emptyBucket()
  const warnings = operatorCosts.flatMap((cost) => cost.warnings)

  for (const cost of operatorCosts) {
    totals.cash += cost.totals.cash
    totals.exp += cost.totals.exp
    missing.cash += cost.missing.cash
    missing.exp += cost.missing.exp
    mergeMaterialAmounts(totals.materials, cost.totals.materials)
    mergeMaterialAmounts(missing.materials, cost.missing.materials)
  }

  totals.equivalent_sanity = calculateBucketSanity(totals, pricing).value
  const missingSanity = calculateBucketSanity(missing, pricing)
  missing.equivalent_sanity = missingSanity.value

  const unpricedItems = missingSanity.unpricedItems
  const status: UpgradeTrainingCost['status'] = unpricedItems.length > 0 ? 'partial' : 'available'
  return {
    status,
    target: operatorCosts.length === 1
      ? {
        id: operatorCosts[0].id,
        name: operatorCosts[0].name,
        current_elite: operatorCosts[0].current_elite,
        target_elite: operatorCosts[0].target_elite,
      }
      : undefined,
    totals,
    missing,
    equivalent_sanity: missing.equivalent_sanity,
    unpriced_items: unpricedItems,
    sources: {
      skland: 'ok',
      yituliu: pricing.status,
      lmd_exp: 'fixed_36_per_10000',
    },
    warnings,
    operators: operatorCosts,
  }
}

function calculateMissingBucket(totals: CostBucket, inventory: InventoryItem[], pricing: PricingState): CostBucket {
  const byId = new Map(inventory.map((item) => [item.id, item.count]))
  const totalCash = byId.get('4001') ?? 0
  let totalExp = 0
  for (const [id, value] of Object.entries(EXP_ITEM_VALUES)) {
    totalExp += (byId.get(id) ?? 0) * value
  }
  const missing = emptyBucket()
  missing.cash = Math.max(0, totals.cash - totalCash)
  missing.exp = Math.max(0, totals.exp - totalExp)
  for (const material of totals.materials) {
    const lackCount = Math.max(0, material.count - (byId.get(material.id) ?? 0))
    if (lackCount > 0) missing.materials.push({ ...material, count: lackCount })
  }
  missing.equivalent_sanity = calculateBucketSanity(missing, pricing).value
  return missing
}

function calculateBucketSanity(bucket: CostBucket, pricing: PricingState): { value: number | null; unpricedItems: MaterialAmount[] } {
  let total = (bucket.cash + bucket.exp) * FIXED_SANITY_PER_LMD_OR_EXP
  const unpricedItems: MaterialAmount[] = []
  for (const material of bucket.materials) {
    const price = pricing.prices.get(material.id)
    if (!price) {
      if (material.count > 0) unpricedItems.push({ ...material, equivalent_sanity: null })
      continue
    }
    material.equivalent_sanity = round(price * material.count, 2)
    total += material.equivalent_sanity
  }
  if (unpricedItems.length > 0) return { value: null, unpricedItems }
  return { value: round(total, 2), unpricedItems }
}

async function getYituliuPricing(): Promise<PricingState> {
  if (yituliuCache && Date.now() < yituliuCache.expiresAt) return yituliuCache.state
  try {
    const response = await fetch(YITULIU_STAGE_RESULT_URL, { signal: AbortSignal.timeout(25000) })
    if (!response.ok) throw new Error(`yituliu ${response.status}`)
    const data = await response.json()
    const state = { status: 'ok' as const, prices: buildYituliuPriceMap(data) }
    yituliuCache = { expiresAt: Date.now() + YITULIU_CACHE_TTL_MS, state }
    return state
  } catch {
    const state = { status: 'unavailable' as const, prices: new Map<string, number>() }
    yituliuCache = { expiresAt: Date.now() + YITULIU_CACHE_TTL_MS, state }
    return state
  }
}

export function buildYituliuPriceMap(data: unknown): Map<string, number> {
  const prices = new Map<string, number>()
  const lists = collectArraysByKey(data, 'recommendedStageList')
  for (const list of lists) {
    for (const item of list) {
      if (!isRecord(item)) continue
      const nestedItem = isRecord(item.item) ? item.item : null
      const itemId = stringValue(item.itemId ?? item.materialId ?? item.id ?? nestedItem?.id)
      const stages = Array.isArray(item.stageResultList) ? item.stageResultList : []
      const price = minPositive(stages.map((stage) => isRecord(stage) ? numberValue(stage.apExpect) : null))
      if (itemId && price) setLowerPrice(prices, itemId, price)
    }
  }
  const stageLists = collectArraysByKey(data, 'stageResultList')
  for (const list of stageLists) {
    for (const stage of list) {
      if (!isRecord(stage)) continue
      const nestedItem = isRecord(stage.item) ? stage.item : null
      const itemId = stringValue(stage.itemId ?? stage.materialId ?? stage.id ?? nestedItem?.id)
      const price = numberValue(stage.apExpect)
      if (itemId && price && price > 0) setLowerPrice(prices, itemId, price)
    }
  }
  return prices
}

function createCultivateContext(client: SklandClient, calInfo: unknown, calPlayer: unknown): CultivateContext {
  const calInfoRecord = unwrapDataRecord(calInfo)
  const calPlayerRecord = unwrapDataRecord(calPlayer)
  return {
    client,
    calInfo: calInfoRecord,
    calPlayer: calPlayerRecord,
    itemMeta: createItemMeta(calInfoRecord.items),
    playerItems: readInventoryItems(calPlayerRecord.items),
    playerCharacters: Array.isArray(calPlayerRecord.characters)
      ? calPlayerRecord.characters.filter(isRecord)
      : [],
  }
}

function normalizeCharacterCost(value: unknown, characterId: string): Record<string, unknown> {
  const record = unwrapDataRecord(value)
  if (Array.isArray(record.evolvePhaseCost)) return record
  for (const key of ['character', 'characterInfo', 'info', 'detail']) {
    const nested = ensureRecord(record[key])
    if (Array.isArray(nested.evolvePhaseCost)) return nested
  }
  const characters = Array.isArray(record.characters) ? record.characters : []
  const matched = characters
    .filter(isRecord)
    .find((character) => stringValue(character.id ?? character.charId ?? character.characterId) === characterId)
  if (matched && Array.isArray(matched.evolvePhaseCost)) return matched
  return record
}

function unwrapDataRecord(value: unknown): Record<string, unknown> {
  const record = ensureRecord(value)
  return isRecord(record.data) ? record.data : record
}

function getSuggestionTargets(suggestion: UpgradeSuggestionLike): CostTarget[] {
  if (suggestion.type === 'single') {
    const id = stringValue(suggestion.id)
    const name = stringValue(suggestion.name)
    const currentElite = numberValue(suggestion.current ?? suggestion.current_elite) ?? 0
    const targetElite = numberValue(suggestion.target ?? suggestion.target_elite) ?? currentElite
    if (!id && !name) return []
    return [{ id, name, currentElite, targetElite }]
  }
  if (suggestion.type === 'bundle' && Array.isArray(suggestion.ops)) {
    return suggestion.ops
      .filter(isRecord)
      .map((op) => ({
        id: stringValue(op.id),
        name: stringValue(op.name),
        currentElite: numberValue(op.current ?? op.current_elite) ?? 0,
        targetElite: numberValue(op.target ?? op.target_elite) ?? 0,
      }))
      .filter((target) => target.id || target.name)
  }
  return []
}

function resolveOperator(target: CostTarget, operators: LicenseOperator[]): LicenseOperator | null {
  return operators.find((operator) => (
    (target.id && operator.id === target.id) ||
    (target.name && operator.name === target.name)
  )) ?? null
}

function findPlayerCharacter(characters: Record<string, unknown>[], id: string): Record<string, unknown> | null {
  return characters.find((character) => stringValue(character.id ?? character.charId ?? character.characterId) === id) ?? null
}

function createOperatorUnavailableCost(target: CostTarget, warning: string): OperatorCost {
  return {
    id: target.id,
    name: target.name,
    current_elite: target.currentElite,
    target_elite: target.targetElite,
    current_level: 0,
    target_level: 0,
    totals: emptyBucket(),
    missing: emptyBucket(),
    warnings: [warning],
  }
}

function createUnavailableCost(message: string): UpgradeTrainingCost {
  return {
    status: 'unavailable',
    totals: emptyBucket(),
    missing: emptyBucket(),
    equivalent_sanity: null,
    unpriced_items: [],
    sources: {
      skland: 'unavailable',
      yituliu: 'unavailable',
      lmd_exp: 'fixed_36_per_10000',
    },
    warnings: [message],
    operators: [],
  }
}

function emptyBucket(): CostBucket {
  return { cash: 0, exp: 0, materials: [], equivalent_sanity: 0 }
}

function mergeMaterials(target: MaterialAmount[], rawItems: unknown[], itemMeta: Record<string, unknown>): void {
  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) continue
    const id = stringValue(rawItem.id)
    const count = numberValue(rawItem.count) ?? 0
    if (!id || id === '4001' || count <= 0) continue
    const meta = isRecord(itemMeta[id]) ? itemMeta[id] : {}
    mergeMaterialAmounts(target, [{
      id,
      name: stringValue(meta.name ?? rawItem.name) || `材料 ${id}`,
      count,
      rarity: numberValue(meta.rarity) ?? undefined,
      sortId: numberValue(meta.sortId) ?? undefined,
    }])
  }
}

function mergeMaterialAmounts(target: MaterialAmount[], items: MaterialAmount[]): void {
  for (const item of items) {
    const existing = target.find((targetItem) => targetItem.id === item.id)
    if (existing) {
      existing.count += item.count
      continue
    }
    target.push({ ...item })
  }
  target.sort((a, b) => (a.sortId ?? 9999999) - (b.sortId ?? 9999999) || a.id.localeCompare(b.id))
}

function readInventoryItems(value: unknown): InventoryItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item) => ({
      id: stringValue(item.id),
      count: numberValue(item.count) ?? 0,
    }))
    .filter((item) => item.id && item.count > 0)
}

function createItemMeta(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const map: Record<string, unknown> = {}
    for (const item of value) {
      if (!isRecord(item)) continue
      const id = stringValue(item.id)
      if (id) map[id] = item
    }
    return map
  }
  return ensureRecord(value)
}

function collectArraysByKey(value: unknown, key: string, arrays: unknown[][] = [], depth = 0): unknown[][] {
  if (depth > 8 || !value || typeof value !== 'object') return arrays
  if (Array.isArray(value)) {
    for (const item of value) collectArraysByKey(item, key, arrays, depth + 1)
    return arrays
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record[key])) arrays.push(record[key] as unknown[])
  for (const child of Object.values(record)) collectArraysByKey(child, key, arrays, depth + 1)
  return arrays
}

function setLowerPrice(prices: Map<string, number>, itemId: string, price: number): void {
  const existing = prices.get(itemId)
  if (!existing || price < existing) prices.set(itemId, price)
}

function minPositive(values: (number | null)[]): number | null {
  const positives = values.filter((value): value is number => typeof value === 'number' && value > 0)
  return positives.length > 0 ? Math.min(...positives) : null
}

function positiveArrayValue(values: number[] | undefined, index: number): number {
  const value = values?.[index] ?? 0
  return value > 0 ? value : 0
}

function normalizeRarity(value: number | null): number | null {
  if (value === null || !Number.isInteger(value) || value < 0 || value > 5) return null
  return value
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const LEVEL = levelData as LevelData
