import type { CultivationCurrent, CultivationTarget } from '../../src/lib/cultivation-contract'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'

export { cultivationSatisfied } from '../../src/lib/cultivation-target'

export function cultivationCosts(snapshot: PrtsSnapshot, id: string, current: CultivationCurrent, target: CultivationTarget, skillId: string) {
  const warnings: string[] = []
  const items: Record<string, number> = {}
  const add = (cost: unknown) => {
    if (!cost || typeof cost !== 'object' || Array.isArray(cost)) { warnings.push('养成材料表缺失'); return }
    for (const [item, count] of Object.entries(cost)) {
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) { warnings.push('养成材料数量无效'); continue }
      items[item] = (items[item] ?? 0) + count
    }
  }
  const info = snapshot.operators[id]
  const row = snapshot.costs.cultivate[id.replace(/^char_/, '')]
  if (!info || !row) return { items, warnings: ['缺少该干员的养成材料表'] }
  const levels = snapshot.costs.levels
  const maxima = levels.maxLevel[info.rarity - 1]
  let elite = Math.max(target.elite, target.skillLevel > 7 ? 2 : target.skillLevel > 4 ? 1 : 0)
  let level = elite === target.elite ? target.level : 1
  const module = target.moduleId ? snapshot.costs.modules.equipDict[target.moduleId] : null
  if (module) {
    const phase = Number(String(module.unlockEvolvePhase ?? 'PHASE_2').slice(-1))
    if (elite <= phase) { level = Math.max(elite === phase ? level : 1, Number(module.unlockLevel)); elite = phase }
  }
  if (!maxima || elite < 0 || elite >= maxima.length || level < 1 || level > maxima[elite] || target.skillLevel < 1 || target.skillLevel > 10) return { items, warnings: ['目标练度超过该干员上限'] }
  for (let phase = current.elite; phase <= elite; phase++) {
    const startLevel = phase === current.elite ? current.level : 1
    const endLevel = phase < elite ? maxima[phase] : level
    for (let index = startLevel - 1; index < endLevel - 1; index++) {
      const exp = levels.characterExp[phase]?.[index], lmd = levels.characterUpgradeCost[phase]?.[index]
      if (exp === undefined || lmd === undefined) warnings.push('等级消耗表不完整')
      else add({ exp, '4001': lmd })
    }
    if (phase < elite) {
      add({ '4001': levels.eliteCost[info.rarity - 1]?.[phase] ?? 0 })
      const promotions = Array.isArray(row.evolve) ? row.evolve : []
      add(promotions[phase] ?? (info.rarity <= 3 ? {} : null))
    }
  }
  if (current.skillLevel === null && target.skillLevel > 1) warnings.push('森空岛未返回当前技能等级')
  const skills = asRecord(row.skills)
  const normal = Array.isArray(skills.normal) ? skills.normal : []
  for (let index = (current.skillLevel ?? 1) - 1; index < Math.min(7, target.skillLevel) - 1; index++) add(normal[index])
  if (target.skillLevel > 7) {
    if (current.masteries[skillId] === undefined) warnings.push('森空岛未返回所选技能的专精等级')
    const mastery = asRecord(asRows(skills.elite)[target.skill - 1])
    const costs = Array.isArray(mastery.cost) ? mastery.cost : []
    for (let index = current.masteries[skillId] ?? 0; index < target.skillLevel - 7; index++) add(costs[index])
  }
  if (target.moduleId) {
    if (current.modulesKnown === false) warnings.push('森空岛未返回当前模组数据')
    if (!module || module.charId !== id) warnings.push('模组与干员不匹配')
    else for (let rank = (current.modules[target.moduleId] ?? 0) + 1; rank <= (target.moduleLevel ?? 1); rank++) {
      const cost = asRecord(module.itemCost)[String(rank)]
      if (!Array.isArray(cost)) warnings.push('模组材料表不完整')
      else for (const item of asRows(cost)) add({ [String(item.id)]: item.count })
    }
    // Unknown homework ranks only budget opening the recommended module.
    if (target.moduleLevel !== null && (target.moduleLevel < 1 || target.moduleLevel > 3)) warnings.push('模组等级无效')
  }
  if (target.potential > current.potential) warnings.push('潜能不足，需要另行获取信物或重复干员')
  return { items: Object.fromEntries(Object.entries(items).filter(([, count]) => count > 0)), warnings: [...new Set(warnings)] }
}
