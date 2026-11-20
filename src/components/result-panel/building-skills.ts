import catalog from '../../data/building-skills.json'
import type { RoomOperator } from './types'

export const RECOVERY_SUPPORT_ICON_SRC = '/building-skills/bskill_dorm_all&one1.png'

type Skill = { name: string; room: string; icon: string; description: string }
type Unlock = { id: string; slot: number; elite: number; level: number }
type CatalogOperator = { name: string; skills: Unlock[]; profession: string }
type Profession = 'WARRIOR' | 'SNIPER' | 'TANK' | 'MEDIC' | 'SUPPORT' | 'CASTER' | 'SPECIAL' | 'PIONEER'
const skills: Record<string, Skill> = catalog.skills
const operators: Record<string, CatalogOperator> = catalog.operators
const byName = new Map(Object.entries(operators).map(([id, operator]) => [operator.name, id]))

export function operatorProfession(operator: RoomOperator): Profession | undefined {
  const character = operators[operator.id ?? ''] ?? operators[byName.get(operator.name) ?? '']
  return character?.profession as Profession | undefined
}

export function operatorBuildingSkills(operator: RoomOperator) {
  const character = operators[operator.id ?? ''] ?? operators[byName.get(operator.name) ?? '']
  if (!character) return []
  const unlocked = (skill: Unlock) => {
    if (operator.elite === undefined || !Number.isInteger(operator.elite) || operator.elite < 0) return null
    if (operator.elite !== skill.elite) return operator.elite > skill.elite
    if (skill.level === 1) return true
    const level = Number(operator.level)
    return Number.isInteger(level) && level >= 1 ? level >= skill.level : null
  }
  const active = new Map<number, string>()
  const uncertain = new Set<number>()
  for (const skill of character.skills) {
    const ready = unlocked(skill)
    if (ready) active.set(skill.slot, skill.id)
    else if (ready === null) uncertain.add(skill.slot)
  }
  return character.skills.map((skill) => {
    const ready = unlocked(skill)
    const current = active.get(skill.slot) === skill.id
    let state = 'locked'
    if (ready === null || current && uncertain.has(skill.slot)) state = 'unknown'
    else if (ready) state = current ? 'active' : 'upgraded'
    return { ...skills[skill.id], ...skill, state }
  })
}
