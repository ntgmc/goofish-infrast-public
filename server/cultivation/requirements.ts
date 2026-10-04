import type { CultivationTarget } from '../../src/lib/cultivation-contract'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'

function textRequirement(text: string): Record<string, number> {
  const result: Record<string, number> = {}
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
  if (/无模组|无模|不带模组/.test(normalized)) result.module = 0
  const potential = normalized.match(/潜能?\s*([一二三四五六123456])/)
  if (potential) result.potentiality = Number(potential[1]) || ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[potential[1]]
  return result
}

export function readHomeworkRequirements(content: Record<string, unknown>, snapshot: PrtsSnapshot, byName = new Map(Object.entries(snapshot.operators).map(([id, info]) => [info.name, { id, ...info }]))) {
  const fixed = asRows(content.opers)
  const groups = asRows(content.groups).map((group) => asRows(group.opers))
  const raw = [...fixed, ...groups.flat()]
  const names = raw.map((row) => String(row.name ?? ''))
  const doc = asRecord(content.doc)
  const text = `${doc.title ?? ''}\n${doc.details ?? ''}`
  const global: Record<string, number> = {}
  const specific: Record<string, Record<string, number>> = {}
  for (const line of text.split('\n')) {
    const matched = names.filter((name) => name && line.includes(name))
    const isGlobal = /全员|全部|所有干员|均练/.test(line) || (!matched.length && /练度/.test(line))
    if (!matched.length && !isGlobal) continue
    const fields = textRequirement(line)
    const merge = (target: Record<string, number>) => Object.entries(fields).forEach(([key, value]) => { target[key] = Math.max(target[key] ?? value, value) })
    if (isGlobal) merge(global)
    for (const name of matched) merge(specific[name] ??= {})
  }
  const parse = (row: Record<string, unknown>) => {
    const name = String(row.name ?? '')
    const operator = byName.get(name)
    const fields: Record<string, number> = { ...global, ...specific[name] }
    const structured = asRecord(row.requirements)
    const unspecified = ['elite', 'level', 'skill_level', 'potentiality'].every((field) => structured[field] === 0) && [0, -1].includes(Number(structured.module))
    if (!unspecified) for (const [key, value] of Object.entries(structured)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && (!['level', 'skill_level', 'potentiality'].includes(key) || value > 0)) fields[key] = value
    }
    const warnings = ['elite', 'level', 'skill_level'].filter((key) => fields[key] === undefined).map((key) => `作业未注明${({ elite: '精英阶段', level: '等级', skill_level: '技能等级' } as Record<string, string>)[key]}`)
    const skill = Number(row.skill ?? 1)
    const moduleNumber = fields.module ?? 0
    const moduleId = moduleNumber > 0 && operator ? snapshot.costs.modules.charEquip[operator.id]?.[moduleNumber] ?? null : null
    if (moduleNumber > 0 && !moduleId) warnings.push('作业模组编号无法识别')
    if ((moduleNumber > 0 && fields.module_level === undefined) || (fields.module_level > 0 && moduleNumber === 0)) warnings.push('作业未完整注明模组编号与等级')
    if (!Number.isInteger(skill) || skill < 1 || skill > 3) warnings.push('作业技能编号无效')
    const target: CultivationTarget = { elite: fields.elite ?? 0, level: fields.level ?? 1, skill, skillLevel: fields.skill_level ?? 1, moduleId, moduleLevel: moduleNumber > 0 ? fields.module_level ?? 0 : 0, potential: fields.potentiality ?? 1 }
    return { name, operator, target, warnings }
  }
  return { fixed: fixed.map(parse), groups: groups.map((rows) => rows.map(parse)) }
}
