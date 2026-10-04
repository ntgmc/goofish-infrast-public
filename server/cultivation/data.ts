import type { CultivationCandidate, CultivationData } from '../../src/lib/cultivation-contract'
import { getExpSanity, getNetLmdSanity, type PricingState } from '../handlers/material-value'
import type { PrtsSnapshot } from './catalog'
import { cultivationCosts, cultivationSatisfied } from './costs'
import { readCultivationPlayer } from './player'
import { readHomeworkRequirements } from './requirements'

export function buildCultivationData(snapshot: PrtsSnapshot, playerInfo: unknown, cultivatePlayer: unknown, pricing: PricingState, mode: string): CultivationData {
  const player = readCultivationPlayer(playerInfo, cultivatePlayer, snapshot)
  const candidates = new Map<string, CultivationCandidate & { stages: Set<string>; homeworkIds: Set<number> }>()
  const missingOperators = new Set<string>()
  let incomplete = 0
  const operatorsByName = new Map(Object.entries(snapshot.operators).map(([id, info]) => [info.name, { id, ...info }]))
  const homeworks = snapshot.homeworks.filter((row) => mode === 'all' || (row.mode & (mode === 'normal' ? 1 : 2)) !== 0)
  for (const homework of homeworks) {
    const parsed = readHomeworkRequirements(homework.content, snapshot, operatorsByName)
    const add = (requirement: (typeof parsed.fixed)[number], weight: number, fixed: boolean) => {
      const operator = requirement.operator
      if (!operator) { incomplete++; return }
      const current = player.characters.get(operator.id)
      if (!current) { missingOperators.add(requirement.name); return }
      const skillId = operator.skills[requirement.target.skill - 1] ?? ''
      const key = `${operator.id}:${JSON.stringify(requirement.target)}`
      let entry = candidates.get(key)
      if (!entry) {
        const cost = cultivationCosts(snapshot, operator.id, current, requirement.target, skillId)
        const warnings = [...new Set([...requirement.warnings, ...cost.warnings])]
        if (!skillId && requirement.target.skillLevel > 7) warnings.push('专精技能编号无法匹配')
        entry = { key, operatorId: operator.id, name: operator.name, current, target: requirement.target, skillId, frequency: 0, fixedFrequency: 0, stageCount: 0, examples: [], items: cost.items, warnings, satisfied: warnings.length === 0 && cultivationSatisfied(current, requirement.target, skillId), stages: new Set(), homeworkIds: new Set() }
        candidates.set(key, entry)
      }
      if (!entry.homeworkIds.has(homework.id)) {
        entry.homeworkIds.add(homework.id)
        entry.frequency += weight
        if (fixed) entry.fixedFrequency++
        if (entry.examples.length < 3) entry.examples.push(homework.id)
      }
      entry.stages.add(homework.stageId)
    }
    for (const requirement of parsed.fixed) add(requirement, 1, true)
    for (const group of parsed.groups) {
      const alreadySatisfied = group.some((requirement) => {
        if (!requirement.operator || requirement.warnings.length) return false
        const current = player.characters.get(requirement.operator.id)
        return current && cultivationSatisfied(current, requirement.target, requirement.operator.skills[requirement.target.skill - 1] ?? '')
      })
      if (alreadySatisfied) continue
      for (const requirement of group) add(requirement, 1 / group.length, false)
    }
  }
  const prices = Object.fromEntries(pricing.prices)
  prices.exp = getExpSanity(1)
  prices['4001'] = getNetLmdSanity(pricing)
  return {
    candidates: [...candidates.values()].map(({ stages, homeworkIds: _ids, ...candidate }) => ({ ...candidate, stageCount: stages.size })),
    inventory: player.inventory, potions: player.potions, prices,
    itemNames: { ...snapshot.itemNames, exp: '作战经验', '4001': '龙门币' }, recipes: snapshot.recipes, farms: snapshot.farms,
    stats: { homeworks: homeworks.length, owned: player.characters.size, missingOperators: missingOperators.size, incomplete: incomplete + [...candidates.values()].filter((row) => row.warnings.length).length },
    updatedAt: snapshot.updatedAt, importedAt: new Date().toISOString(), pricingStatus: pricing.status,
    warnings: [...snapshot.warnings, ...(pricing.status === 'fresh' ? [] : [pricing.status === 'stale' ? '材料价格使用有效期内的历史价格' : '材料价格暂不可用，未估价材料不会按零成本处理'])],
  }
}
