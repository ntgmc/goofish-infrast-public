import type { CultivationTarget } from '../../src/lib/cultivation-contract'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'

function textRequirement(text: string): Record<string, number | string> {
  const result: Record<string, number | string> = {}
  const digit = (value: string) => Number(value) || ({ 零: 0, 一: 1, 二: 2, 三: 3 } as Record<string, number>)[value] || 0
  const normalized = text.normalize('NFKC')
  const compact = normalized.match(/(?<!\d)([012])(\d{2})([0-3])(?!\d)/)
  if (compact) Object.assign(result, { elite: Number(compact[1]), level: Number(compact[2]), skill_level: 7 + Number(compact[3]) })
  const elite = normalized.match(/(?:精英?|[eE])\s*([012零一二])\s*(?:阶段)?\s*(\d{1,2})?/)
  if (elite) { result.elite = digit(elite[1]); if (elite[2]) result.level = Number(elite[2]) }
  const level = normalized.match(/(?:等级|[lL][vV]|level)\s*[.:：]?\s*(\d{1,2})/)
  if (level) result.level = Number(level[1])
  const mastery = normalized.match(/专(?:精)?\s*([一二三123])/)
  if (mastery) result.skill_level = 7 + digit(mastery[1])
  else if (/无专精|不专|技能\s*7/.test(normalized)) result.skill_level = 7
  const module = normalized.match(/(?:(?:模组?|module)\s*([一二三123])(?:级)?|([一二三123])级?模组)/i)
  if (module) result.module_level = digit(module[1] || module[2])
  const moduleType = normalized.match(/([XYDABαΔ])\s*(?:模组?|module)/i)
  if (moduleType) result.module_type = ({ α: 'A', Δ: 'D' } as Record<string, string>)[moduleType[1]] ?? moduleType[1].toUpperCase()
  if (/无模组|无模|不带模组/.test(normalized)) { result.module = 0; delete result.module_level; delete result.module_type }
  const potential = normalized.match(/潜能?\s*([一二三四五六123456])/)
  if (potential) result.potentiality = Number(potential[1]) || ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[potential[1]]
  return result
}

export function readHomeworkRequirements(content: Record<string, unknown>, snapshot: PrtsSnapshot, byName = new Map(Object.entries(snapshot.operators).map(([id, info]) => [info.name, { id, ...info }]))) {
  const fixed = asRows(content.opers)
  const groups = asRows(content.groups).map((group) => asRows(group.opers))
  const names = [...fixed, ...groups.flat()].map((row) => String(row.name ?? ''))
  const doc = asRecord(content.doc)
  const text = `${doc.title ?? ''}\n${doc.details ?? ''}`
  const global: Record<string, number | string> = {}
  const specific: Record<string, Record<string, number | string>> = {}
  for (const line of text.split('\n')) {
    const matched = names.filter((name) => name && line.includes(name))
    const isGlobal = /全员|全部|所有干员|均练/.test(line) || (!matched.length && /练度/.test(line))
    if (!matched.length && !isGlobal) continue
    const fields = textRequirement(line)
    const merge = (target: Record<string, number | string>) => Object.entries(fields).forEach(([key, value]) => {
      target[key] = typeof value === 'number' ? Math.max(Number(target[key] ?? value), value) : value
    })
    if (isGlobal) merge(global)
    for (const name of matched) merge(specific[name] ??= {})
  }
  const parse = (row: Record<string, unknown>) => {
    const name = String(row.name ?? '')
    const operator = byName.get(name)
    const fields: Record<string, number | string> = { ...global, ...specific[name] }
    const structured = asRecord(row.requirements)
    const unspecified = ['elite', 'level', 'skill_level', 'potentiality'].every((field) => !structured[field]) && [0, -1].includes(Number(structured.module ?? -1))
    if (!unspecified) for (const [key, value] of Object.entries(structured)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && (!['level', 'skill_level', 'potentiality'].includes(key) || value > 0)) fields[key] = value
    }
    const warnings: string[] = []
    const skill = Number(row.skill ?? 1)
    const moduleNumber = Number(fields.module ?? 0)
    const equips = operator ? snapshot.costs.modules.charEquip[operator.id] ?? [] : []
    const moduleId = fields.module_type ? equips.find((id) => String(snapshot.costs.modules.equipDict[id]?.typeName2).toUpperCase() === fields.module_type) ?? null
      : moduleNumber > 0 ? equips[moduleNumber] ?? null : null
    if ((moduleNumber > 0 || fields.module_type) && !moduleId) warnings.push('作业模组编号无法识别')
    if (fields.module_level && !moduleId) warnings.push('作业未注明所需模组类型')
    if (!Number.isInteger(skill) || skill < 1 || skill > 3 || (operator && !operator.skills[skill - 1])) warnings.push('作业技能编号无效')
    const skillLevel = Number(fields.skill_level ?? 1)
    let elite = Math.max(Number(fields.elite ?? 0), skill === 3 || skillLevel > 7 ? 2 : skill === 2 || skillLevel > 4 ? 1 : 0)
    let level = elite === Number(fields.elite ?? 0) ? Number(fields.level ?? 1) : 1
    const module = moduleId ? snapshot.costs.modules.equipDict[moduleId] : null
    if (module) {
      const phase = Number(String(module.unlockEvolvePhase ?? 'PHASE_2').slice(-1))
      if (elite <= phase) { level = Math.max(elite === phase ? level : 1, Number(module.unlockLevel)); elite = phase }
    }
    const target: CultivationTarget = { elite, level, skill, skillLevel, moduleId, moduleLevel: moduleId ? Number(fields.module_level ?? 1) : 0, potential: Number(fields.potentiality ?? 1) }
    return { name, operator, target, warnings, minimumOnly: Object.keys(fields).length === 0 }
  }
  return { fixed: fixed.map(parse), groups: groups.map((rows) => rows.map(parse)) }
}
