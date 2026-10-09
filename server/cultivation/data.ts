import { defaultCultivationQuery, type CultivationCandidate, type CultivationData, type CultivationQuery } from '../../src/lib/cultivation-contract'
import { getExpSanity, getNetLmdSanity, type PricingState } from '../handlers/material-value'
import type { PrtsSnapshot } from './catalog'
import { cultivationCosts, cultivationSatisfied } from './costs'
import { readCultivationPlayer } from './player'
import { getCultivationRecommendations } from './recommendations'
import { buildSpecialItemRecommendations, type SpecialItemCatalog } from './special-items'

export function buildCultivationData(snapshot: PrtsSnapshot, playerInfo: unknown, cultivatePlayer: unknown, pricing: PricingState, community?: CultivationData['community'], specialCatalog?: SpecialItemCatalog, query: CultivationQuery = defaultCultivationQuery): CultivationData {
  const player = readCultivationPlayer(playerInfo, cultivatePlayer, snapshot)
  const candidates = new Map<string, CultivationCandidate & { stages: Set<string> }>()
  const missingOperators = new Set<string>()
  const recommendation = getCultivationRecommendations(snapshot, query)
  const groups = new Map<string, NonNullable<CultivationData['groups']>[number]>()
  const demands = new Map<string, { total: number; skills: Record<number, number>; elite: number }>()
  const countedDemands = new Set<string>()
  for (const branch of recommendation.recommendations) {
    const operator = snapshot.operators[branch.operatorId]
    const current = player.characters.get(branch.operatorId)
    const skillId = operator.skills[branch.target.skill - 1] ?? ''
    const key = `${branch.operatorId}:${JSON.stringify(branch.target)}`
    const cost = current ? cultivationCosts(snapshot, branch.operatorId, current, branch.target, skillId) : null
    const entry = current && cost ? { key, operatorId: branch.operatorId, name: operator.name, current, target: branch.target, skillId,
      evidence: branch.evidence, moduleName: branch.target.moduleId ? String(snapshot.costs.modules.equipDict[branch.target.moduleId]?.uniEquipName ?? branch.target.moduleId) : undefined,
      demandKeys: [] as string[], demandWeights: {} as Record<string, number>, frequency: 0, weightedFrequency: 0, fixedFrequency: 0, stageCount: 0, examples: [] as number[],
      ...cost, satisfied: cost.warnings.length === 0 && cultivationSatisfied(current, branch.target, skillId), stages: new Set<string>() } : null
    for (const sample of branch.samples) {
      const { requirement, document, weight, group, options } = sample
      const demandKey = `${sample.family}:${group === null ? 'fixed:' + branch.operatorId : 'group:' + group}`
      if (group !== null) {
        const valid = options.filter((row) => row.operator && !row.warnings.length)
        if (valid.some((row) => {
          const current = player.characters.get(row.operator!.id)
          return current && cultivationSatisfied(current, row.target, row.operator!.skills[row.target.skill - 1] ?? '')
        })) continue
        groups.set(demandKey, { key: demandKey, options: valid.map((row) => ({ operatorId: row.operator!.id, target: row.target, skillId: row.operator!.skills[row.target.skill - 1] ?? '' })) })
      }
      const demandId = `${branch.operatorId}:${demandKey}:${document.homework.id}`
      if (!countedDemands.has(demandId)) {
        countedDemands.add(demandId)
        const count = demands.get(branch.operatorId) ?? { total: 0, skills: {}, elite: 0 }
        count.total += weight
        if (requirement.target.elite === 2) count.elite += weight
        if (requirement.target.skillLevel > 7) count.skills[requirement.target.skill] = (count.skills[requirement.target.skill] ?? 0) + weight
        demands.set(branch.operatorId, count)
      }
      if (!entry) { missingOperators.add(operator.name); continue }
      if (!entry.demandKeys.includes(demandKey)) {
        entry.demandKeys.push(demandKey); entry.frequency++
        if (group === null) entry.fixedFrequency++
        if (entry.examples.length < 3) entry.examples.push(document.homework.id)
      }
      entry.demandWeights[demandKey] = (entry.demandWeights[demandKey] ?? 0) + weight
      entry.weightedFrequency += weight
      entry.stages.add(document.homework.stageId)
    }
    if (entry?.frequency) candidates.set(key, entry)
  }
  const prices = Object.fromEntries(pricing.prices)
  prices.exp = getExpSanity(1)
  prices['4001'] = getNetLmdSanity(pricing)
  if (prices['4006'] !== undefined) prices['32001'] = prices['4006'] * 90
  const result: CultivationCandidate[] = [...candidates.values()].map(({ stages, ...candidate }) => ({ ...candidate, stageCount: stages.size, source: 'homework' }))
  for (const [id, current] of player.characters) {
    const statistics = community?.operators[id]
    const operator = snapshot.operators[id]
    if (!statistics || statistics.owned < 100 || operator.rarity < 4) continue
    if (query.rarity && operator.rarity !== query.rarity || query.profession && operator.profession !== query.profession || query.search && !operator.name.toLowerCase().includes(query.search.trim().toLowerCase())) continue
    const addCommunity = (target: CultivationCandidate['target'], rate: number) => {
      if (rate <= 0) return
      const skillId = operator.skills[target.skill - 1] ?? ''
      const cost = cultivationCosts(snapshot, id, current, target, skillId)
      result.push({ key: `community:${id}:${JSON.stringify(target)}`, operatorId: id, name: operator.name, current, target, skillId,
        source: 'community', communityRate: rate, frequency: 0, fixedFrequency: 0, stageCount: 0, examples: [], ...cost,
        moduleName: target.moduleId ? String(snapshot.costs.modules.equipDict[target.moduleId]?.uniEquipName ?? target.moduleId) : undefined,
        satisfied: cost.warnings.length === 0 && cultivationSatisfied(current, target, skillId) })
    }
    const base = { elite: 2, level: 1, skill: 1, skillLevel: 1, moduleId: null, moduleLevel: 0, potential: 1 }
    addCommunity(base, statistics.elite[2])
    operator.skills.forEach((_skill, index) => {
      for (let rank = 1; rank <= 3; rank++) addCommunity({ ...base, skill: index + 1, skillLevel: 7 + rank }, statistics.skills[index]?.slice(rank).reduce((sum, rate) => sum + rate, 0) ?? 0)
    })
    for (const moduleId of snapshot.costs.modules.charEquip[id] ?? []) {
      const equip = snapshot.costs.modules.equipDict[moduleId]
      if (!equip || equip.type === 'INITIAL') continue
      const distribution = statistics.modules[String(equip.typeName2)]
      for (let rank = 1; rank <= 3; rank++) addCommunity({ ...base, level: Number(equip.unlockLevel), moduleId, moduleLevel: rank }, distribution?.slice(rank).reduce((sum, rate) => sum + rate, 0) ?? 0)
    }
  }
  return {
    candidates: result, community,
    recommendation: { query, families: recommendation.families, withoutActions: recommendation.withoutActions, stages: recommendation.stages, professions: recommendation.professions },
    specialItems: specialCatalog ? buildSpecialItemRecommendations(snapshot, player, specialCatalog, community, demands) : [],
    specialItemsUpdatedAt: specialCatalog?.updatedAt || null,
    skillIcons: specialCatalog?.skillIcons,
    itemIcons: specialCatalog?.itemIcons,
    groups: [...groups.values()], inventory: player.inventory, potions: player.potions, prices,
    itemNames: { ...snapshot.itemNames, ...specialCatalog?.itemNames, exp: '作战经验', '4001': '龙门币' }, recipes: snapshot.recipes, farms: snapshot.farms,
    stats: { homeworks: recommendation.homeworks, owned: player.characters.size, missingOperators: missingOperators.size, incomplete: recommendation.invalid + [...candidates.values()].filter((row) => row.warnings.length).length },
    updatedAt: snapshot.updatedAt, importedAt: new Date().toISOString(), pricingStatus: pricing.status,
    warnings: [...snapshot.warnings, ...(snapshot.homeworks.some((row) => !row.uploadedAt) ? ['部分作业缺少发布时间，暂不参与推荐；请重新导入作业数据或等待同步补齐。'] : []), ...(pricing.status === 'fresh' ? [] : [pricing.status === 'stale' ? '材料价格使用有效期内的历史价格' : '材料价格暂不可用，未估价材料不会按零成本处理']), ...(specialCatalog?.status === 'unavailable' ? ['道具资料暂不可用，请稍后重新导入。'] : specialCatalog?.status === 'stale' ? ['道具资料更新暂不可用，当前使用上次数据。'] : [])],
  }
}
