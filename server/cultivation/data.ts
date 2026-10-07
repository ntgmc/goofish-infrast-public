import type { CultivationCandidate, CultivationData } from '../../src/lib/cultivation-contract'
import { getExpSanity, getNetLmdSanity, type PricingState } from '../handlers/material-value'
import type { PrtsSnapshot } from './catalog'
import { cultivationCosts, cultivationSatisfied } from './costs'
import { readCultivationPlayer } from './player'
import { readHomeworkRequirements } from './requirements'
import { buildSpecialItemRecommendations, type SpecialItemCatalog } from './special-items'

function homeworkWeight(homework: PrtsSnapshot['homeworks'][number], now: number): number {
  if (!homework.uploadedAt) return 0
  const ageDays = Math.max(0, (now - Date.parse(homework.uploadedAt)) / 86400000)
  if (ageDays > 365) return 0
  const likes = homework.likes ?? 0
  const votes = likes + (homework.dislikes ?? 0)
  // Wilson's 95% lower bound combines approval with the amount of rating evidence.
  const proportion = votes ? likes / votes : 0
  const z2 = 1.96 ** 2
  const confidence = votes ? Math.max(0, (proportion + z2 / (2 * votes) - 1.96 * Math.sqrt((proportion * (1 - proportion) + z2 / (4 * votes)) / votes)) / (1 + z2 / votes)) : 0
  const popularity = 1 + Math.min(1, Math.log1p(homework.views ?? 0) / Math.log(10001)) + Math.min(1, Math.log1p(homework.hotScore ?? 0) / Math.log(101))
  return (0.1 + 0.9 * confidence) * popularity * 2 ** (-ageDays / 90)
}

export function buildCultivationData(snapshot: PrtsSnapshot, playerInfo: unknown, cultivatePlayer: unknown, pricing: PricingState, community?: CultivationData['community'], specialCatalog?: SpecialItemCatalog): CultivationData {
  const player = readCultivationPlayer(playerInfo, cultivatePlayer, snapshot)
  const candidates = new Map<string, CultivationCandidate & { stages: Set<string>; homeworkIds: Set<number> }>()
  const missingOperators = new Set<string>()
  let incomplete = 0
  const operatorsByName = new Map(Object.entries(snapshot.operators).map(([id, info]) => [info.name, { id, ...info }]))
  const now = Date.now()
  const homeworks = snapshot.homeworks.map((homework) => ({ homework, weight: homeworkWeight(homework, now) }))
    .filter((row) => row.weight > 0).sort((a, b) => b.weight - a.weight || b.homework.id - a.homework.id)
  const groups: NonNullable<CultivationData['groups']> = []
  const demands = new Map<string, { total: number; skills: Record<number, number>; elite: number }>()
  const countedDemands = new Set<string>()
  for (const { homework, weight } of homeworks) {
    const parsed = readHomeworkRequirements(homework.content, snapshot, operatorsByName)
    const add = (requirement: (typeof parsed.fixed)[number], fixed: boolean, demandKey: string) => {
      if (requirement.minimumOnly && requirement.target.elite === 0) return
      const operator = requirement.operator
      if (!operator) { incomplete++; return }
      const demandId = `${operator.id}:${demandKey}`
      if (!countedDemands.has(demandId)) {
        countedDemands.add(demandId)
        const count = demands.get(operator.id) ?? { total: 0, skills: {}, elite: 0 }
        count.total += weight
        if (requirement.target.elite === 2) count.elite += weight
        if (requirement.target.skillLevel > 7) count.skills[requirement.target.skill] = (count.skills[requirement.target.skill] ?? 0) + weight
        demands.set(operator.id, count)
      }
      const current = player.characters.get(operator.id)
      if (!current) { missingOperators.add(requirement.name); return }
      const skillId = operator.skills[requirement.target.skill - 1] ?? ''
      const key = `${operator.id}:${JSON.stringify(requirement.target)}`
      let entry = candidates.get(key)
      if (!entry) {
        const cost = cultivationCosts(snapshot, operator.id, current, requirement.target, skillId)
        const warnings = [...new Set([...requirement.warnings, ...cost.warnings])]
        if (!skillId && requirement.target.skillLevel > 7) warnings.push('专精技能编号无法匹配')
        entry = { key, operatorId: operator.id, name: operator.name, current, target: requirement.target, skillId, moduleName: requirement.target.moduleId ? String(snapshot.costs.modules.equipDict[requirement.target.moduleId]?.uniEquipName ?? requirement.target.moduleId) : undefined, demandKeys: [], demandWeights: {}, frequency: 0, weightedFrequency: 0, fixedFrequency: 0, stageCount: 0, examples: [], items: cost.items, warnings, satisfied: warnings.length === 0 && cultivationSatisfied(current, requirement.target, skillId), stages: new Set(), homeworkIds: new Set() }
        candidates.set(key, entry)
      }
      if (!entry.homeworkIds.has(homework.id)) {
        entry.homeworkIds.add(homework.id)
        if (entry.examples.length < 3) entry.examples.push(homework.id)
      }
      if (!entry.demandKeys!.includes(demandKey)) {
        entry.demandKeys!.push(demandKey)
        entry.demandWeights![demandKey] = weight
        entry.frequency++
        entry.weightedFrequency! += weight
        if (fixed) entry.fixedFrequency++
      }
      entry.stages.add(homework.stageId)
    }
    for (const requirement of parsed.fixed) add(requirement, true, homework.id + ':fixed:' + requirement.name)
    for (const [index, group] of parsed.groups.entries()) {
      const alreadySatisfied = group.some((requirement) => {
        if (!requirement.operator || requirement.warnings.length) return false
        const current = player.characters.get(requirement.operator.id)
        return current && cultivationSatisfied(current, requirement.target, requirement.operator.skills[requirement.target.skill - 1] ?? '')
      })
      if (alreadySatisfied) continue
      const key = homework.id + ':group:' + index
      groups.push({ key, options: group.flatMap((row) => row.operator && !row.warnings.length ? [{ operatorId: row.operator.id, target: row.target, skillId: row.operator.skills[row.target.skill - 1] ?? '' }] : []) })
      for (const requirement of group) add(requirement, false, key)
    }
  }
  const prices = Object.fromEntries(pricing.prices)
  prices.exp = getExpSanity(1)
  prices['4001'] = getNetLmdSanity(pricing)
  if (prices['4006'] !== undefined) prices['32001'] = prices['4006'] * 90
  const result: CultivationCandidate[] = [...candidates.values()].map(({ stages, homeworkIds: _ids, ...candidate }) => ({ ...candidate, stageCount: stages.size, source: 'homework' }))
  for (const [id, current] of player.characters) {
    const statistics = community?.operators[id]
    const operator = snapshot.operators[id]
    if (!statistics || statistics.owned < 100 || operator.rarity < 4) continue
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
    specialItems: specialCatalog ? buildSpecialItemRecommendations(snapshot, player, specialCatalog, community, demands) : [],
    specialItemsUpdatedAt: specialCatalog?.updatedAt || null,
    skillIcons: specialCatalog?.skillIcons,
    itemIcons: specialCatalog?.itemIcons,
    groups, inventory: player.inventory, potions: player.potions, prices,
    itemNames: { ...snapshot.itemNames, ...specialCatalog?.itemNames, exp: '作战经验', '4001': '龙门币' }, recipes: snapshot.recipes, farms: snapshot.farms,
    stats: { homeworks: homeworks.length, owned: player.characters.size, missingOperators: missingOperators.size, incomplete: incomplete + [...candidates.values()].filter((row) => row.warnings.length).length },
    updatedAt: snapshot.updatedAt, importedAt: new Date().toISOString(), pricingStatus: pricing.status,
    warnings: [...snapshot.warnings, ...(snapshot.homeworks.some((row) => !row.uploadedAt) ? ['部分作业缺少发布时间，暂不参与推荐；请重新导入作业数据或等待同步补齐。'] : []), ...(pricing.status === 'fresh' ? [] : [pricing.status === 'stale' ? '材料价格使用有效期内的历史价格' : '材料价格暂不可用，未估价材料不会按零成本处理']), ...(specialCatalog?.status === 'unavailable' ? ['道具资料暂不可用，请稍后重新导入。'] : specialCatalog?.status === 'stale' ? ['道具资料更新暂不可用，当前使用上次数据。'] : [])],
  }
}
