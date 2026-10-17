import type { CultivationCandidate, CultivationData } from '../../src/lib/cultivation-contract'
import type { CultivationProject } from '../../src/lib/cultivation-projects'
import type { PricingState } from '../handlers/material-value'
import type { PrtsSnapshot } from './catalog'
import { cultivationCosts, cultivationSatisfied } from './costs'
import { cultivationResources } from './data'
import { readCultivationPlayer } from './player'
import { CultivationReadError } from './worker-client'

export function buildCultivationProjects(snapshot: PrtsSnapshot, game: unknown, inventory: unknown, pricing: PricingState, projects: CultivationProject[]): CultivationData {
  const player = readCultivationPlayer(game, inventory, snapshot)
  const projectOperators = [...player.characters].flatMap(([id, current]) => {
    const operator = snapshot.operators[id]
    const maxLevels = operator && snapshot.costs.levels.maxLevel[operator.rarity - 1]
    return operator && maxLevels ? [{ id, ...operator, current, maxLevels }] : []
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const candidates: CultivationCandidate[] = projects.map((project) => {
    const operator = projectOperators.find((row) => row.id === project.operatorId)
    if (!operator) throw new CultivationReadError('目标干员不在当前档案中，请刷新练度后重新选择。', 400, 'project_operator_unavailable')
    if (project.level > (operator.maxLevels[project.elite] ?? 0) || project.skill > Math.max(1, operator.skills.length)
      || !operator.skills.length && project.skillLevel > 1
      || operator.skills.length > 0 && project.elite < Math.max(project.skill - 1, project.skillLevel > 7 ? 2 : project.skillLevel > 4 ? 1 : 0)) throw new CultivationReadError('目标练度超过该干员上限，请调整目标。', 400, 'project_target_invalid')
    const target = { elite: project.elite, level: project.level, skill: project.skill, skillLevel: project.skillLevel, moduleId: null, moduleLevel: 0, potential: operator.current.potential }
    const skillId = operator.skills[project.skill - 1] ?? ''
    const cost = cultivationCosts(snapshot, operator.id, operator.current, target, skillId)
    return { key: `project:${operator.id}`, operatorId: operator.id, name: operator.name, current: operator.current, target, skillId,
      source: 'project', frequency: 0, fixedFrequency: 0, stageCount: 0, examples: [], ...cost,
      satisfied: !cost.warnings.length && cultivationSatisfied(operator.current, target, skillId) }
  })
  return { ...cultivationResources(snapshot, player, pricing), candidates, projectOperators,
    stats: { homeworks: 0, owned: player.characters.size, missingOperators: 0, incomplete: candidates.filter((row) => row.warnings.length).length },
    warnings: [...snapshot.warnings, ...(pricing.status === 'fresh' ? [] : ['材料估价暂未更新，刷取路线仍按关卡消耗计算。'])] }
}
