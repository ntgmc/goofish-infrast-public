import catalog from '../../data/building-skills.json'
import type { RoomOperator } from './types'

type Skill = { name: string; room: string; icon: string; description: string }
type Unlock = { id: string; slot: number; elite: number; level: number }
type CatalogOperator = { name: string; skills: Unlock[] }
const skills: Record<string, Skill> = catalog.skills
const operators: Record<string, CatalogOperator> = catalog.operators
const byName = new Map(Object.entries(operators).map(([id, operator]) => [operator.name, id]))

export function operatorBuildingSkills(operator: RoomOperator) {
  const character = operators[operator.id ?? ''] ?? operators[byName.get(operator.name) ?? '']
  if (!character) return []
  const unlocked = (skill: Unlock) => operator.elite !== undefined && (
    operator.elite > skill.elite
    || operator.elite === skill.elite && (Number.isFinite(Number(operator.level)) ? Number(operator.level) : 1) >= skill.level
  )
  const active = new Map<number, string>()
  for (const skill of character.skills) if (unlocked(skill)) active.set(skill.slot, skill.id)
  return character.skills.map((skill) => ({
    ...skills[skill.id], ...skill,
    state: operator.elite === undefined ? 'unknown' : active.get(skill.slot) === skill.id ? 'active' : unlocked(skill) ? 'upgraded' : 'locked',
  }))
}
