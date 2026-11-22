import catalog from '../data/building-skills.json'
import published from '../data/building-skill-ratings.json'
import { getFacilityIds } from './facility-layout'
import { calculateTrainingCost } from './training-ratio'
import { warehouseBuildingVariants } from './building-rating-warehouse'
import type { LicenseConfig, LicenseOperator } from './types'

export const BUILDING_RATING_GRADES = ['SSS', 'S', 'A', 'B', 'C', 'D'] as const
export type BuildingRatingGrade = typeof BUILDING_RATING_GRADES[number]
export type RatingScenario = { label: string; score: number; reason: string }
export type SkillAssessment = { skills: string[]; score: number | null; usage: string; reason: string; conditions: string; provisional: boolean; scenarios?: RatingScenario[] }
export type RatingMember = { id: string; room: string; elite: number; level: number; station: string }
export type RatingVariant = { members: RatingMember[]; score: number; reason: string; conditions: string; provisional: boolean; requirements: Record<string, number | boolean | undefined>; recipe?: 'gold' | 'exp'; production?: number; capacity?: number }
export type RatingCombo = { id: string; title: string; room: string; usage: string; variants: RatingVariant[]; core?: string[]; partnerSlots?: number }
export type RatingStage = { elite: number; level: number; skills: string[]; assessment: SkillAssessment }
export type SingleBuildingRating = { id: string; operatorId: string; name: string; room: string; stages: RatingStage[]; stage: RatingStage }
type Skill = { name: string; room: string; icon: string; description: string }
type Character = { name: string; profession: string; skills: { id: string; slot: number; elite: number; level: number }[] }
const characters: Record<string, Character> = catalog.operators
const skills: Record<string, Skill> = catalog.skills
const rarities: Record<string, number> = published.rarities
const meetingStageScores: Record<string, (number | null)[]> = published.meetingStageScores
const reviews: SkillAssessment[] = published.reviews
const joints: SkillAssessment[] = published.joints
export const buildingRatingEdition = { version: published.version, evaluatedAt: published.evaluatedAt, sources: published.sources }
export const buildingRatingCoverage = { operators: Object.keys(characters).length, skills: Object.keys(skills).length }
export const buildingRatingCombos: RatingCombo[] = published.combos.map((combo) => 'partnerSlots' in combo ? { ...combo, variants: warehouseBuildingVariants(combo.id) } : combo)
const reviewBySkill = new Map(reviews.flatMap((review) => review.skills.map((id) => [id, review] as const)))
const signature = (ids: string[]) => [...ids].sort().join('|')
const jointBySkills = new Map(joints.map((review) => [signature(review.skills), review]))

export function buildingRatingGrade(score: number): BuildingRatingGrade {
  return score >= 95 ? 'SSS' : score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D'
}

export function buildingRatingCharacter(id: string) {
  return { ...characters[id], rarity: rarities[id] }
}

export function buildingRatingSkill(id: string) {
  return skills[id]
}

export function buildingMeetingBonus(member: Pick<RatingMember, 'id' | 'elite'>) {
  const rarity = rarities[member.id]
  return { rarity: rarity <= 3 ? 0 : rarity === 4 ? 2 : rarity === 5 ? 4 : 5, elite: member.elite * 8, work: 5 }
}

export const singleBuildingRatings: SingleBuildingRating[] = Object.entries(characters).flatMap(([operatorId, operator]) => {
  const active = new Map<number, string>()
  const stages = new Map<string, RatingStage[]>()
  const dependent = new Set<string>()
  const meetingProgression = operator.skills.some((skill) => skills[skill.id].room === 'meeting')
    ? Array.from({ length: rarities[operatorId] <= 2 ? 1 : rarities[operatorId] === 3 ? 2 : 3 }, (_, elite) => ({ elite, level: 1 })) : []
  const unlocks = [...new Map([...operator.skills, ...meetingProgression].map((unlock) => [`${unlock.elite}.${unlock.level}`, unlock])).values()]
    .sort((a, b) => a.elite - b.elite || a.level - b.level)
  for (const { elite, level } of unlocks) {
    for (const skill of operator.skills) if (skill.elite < elite || skill.elite === elite && skill.level <= level) active.set(skill.slot, skill.id)
    const byRoom = new Map<string, string[]>()
    for (const id of active.values()) {
      const room = skills[id].room
      byRoom.set(room, [...byRoom.get(room) ?? [], id])
    }
    for (const [room, roomSkills] of byRoom) {
      const ids = roomSkills.filter((id) => reviewBySkill.get(id)?.score !== null)
      if (!ids.length) { dependent.add(room); continue }
      dependent.delete(room)
      const assessment = ids.length === 1 ? reviewBySkill.get(ids[0]) : jointBySkills.get(signature(ids))
      if (!assessment || assessment.score === null) throw new Error(`Missing building skill assessment: ${operatorId}/${signature(ids)}`)
      const history = stages.get(room) ?? []
      if (signature(history[history.length - 1]?.skills ?? []) !== signature(ids) || room === 'meeting' && history[history.length - 1]?.elite !== elite) {
        history.push({ elite, level, skills: ids, assessment })
      }
      stages.set(room, history)
    }
  }
  return [...stages].filter(([room]) => !dependent.has(room)).map(([room, history]) => {
    const progression = room === 'meeting' ? history.map((stage) => meetingStage(operatorId, stage)) : history
    return { id: `${operatorId}:${room}`, operatorId, name: operator.name, room, stages: progression, stage: progression[progression.length - 1] }
  })
})

function meetingStage(operatorId: string, stage: RatingStage): RatingStage {
  const score = meetingStageScores[operatorId]?.[stage.elite]
  if (score === null || score === undefined) throw new Error(`Missing meeting stage assessment: ${operatorId}/${stage.elite}`)
  return { ...stage, assessment: { ...stage.assessment, score, provisional: stage.assessment.provisional || stage.skills.some((id) => /更容易|概率|倾向/.test(skills[id].description)) } }
}

export function comboBuildingRatingRange(combo: RatingCombo) {
  const scores = combo.variants.map((variant) => variant.score)
  const low = Math.min(...scores), high = Math.max(...scores)
  return { low, high, lowGrade: buildingRatingGrade(low), highGrade: buildingRatingGrade(high) }
}

export function comboBuildingRatingCore(combo: RatingCombo) {
  return combo.variants[0].members.filter((member) => combo.core ? combo.core.includes(member.id) : combo.variants.every((variant) => variant.members.some((candidate) => candidate.id === member.id && candidate.room === member.room && candidate.station === member.station)))
}

export function relatedBuildingCombos(operatorId: string) {
  return buildingRatingCombos.filter((combo) => combo.variants.some((variant) => variant.members.some((member) => member.id === operatorId)))
}

export type RatingRoster = Map<string, LicenseOperator>
export function buildingRatingRoster(operators: LicenseOperator[]): RatingRoster {
  const byName = new Map(Object.entries(characters).map(([id, character]) => [character.name, id]))
  return new Map(operators.flatMap((operator) => {
    const id = characters[operator.id] ? operator.id : byName.get(operator.name)
    return id ? [[id, operator] as const] : []
  }))
}

export function ratingMemberStatus(member: RatingMember, roster: RatingRoster | null): 'unknown' | 'missing' | 'locked' | 'ready' {
  if (!roster) return 'unknown'
  const owned = roster.get(member.id)
  if (!owned?.own) return 'missing'
  if (!Number.isInteger(owned.elite) || owned.elite < 0) return 'unknown'
  if (owned.elite < member.elite) return 'locked'
  if (owned.elite > member.elite || member.level === 1) return 'ready'
  const level = typeof owned.level === 'number' || typeof owned.level === 'string' ? Number(owned.level) : NaN
  return !Number.isInteger(level) || level < 1 ? 'unknown' : level < member.level ? 'locked' : 'ready'
}

export function ratingVariantStatus(variant: RatingVariant, roster: RatingRoster | null, config: LicenseConfig | null) {
  const memberStates = variant.members.map((member) => ratingMemberStatus(member, roster))
  const membersOwned = roster === null ? null : !memberStates.includes('missing')
  const conditions: { key: string; required: number | boolean; state: 'ready' | 'blocked' | 'unknown' }[] = []
  const required = { ...variant.requirements }
  if (variant.members.some((member) => member.room === 'any')) required.workAssignments = true
  const groups = new Map<string, { room: string; count: number }>()
  for (const member of variant.members) {
    if (member.room === 'any') continue
    const key = `${member.room}:${member.station}`
    groups.set(key, { room: member.room, count: (groups.get(key)?.count ?? 0) + 1 })
  }
  for (const { room, count } of groups.values()) {
    if (room === 'trading') required.tradingLevel = Math.max(Number(required.tradingLevel ?? 1), count)
    if (room === 'manufacture') required.manufactureLevel = Math.max(Number(required.manufactureLevel ?? 1), count)
    if (room === 'meeting') required.meetingLevel = Math.max(Number(required.meetingLevel ?? 1), count)
  }
  const powerRooms = [...groups.values()].filter(({ room }) => room === 'power').length
  if (powerRooms) required.powerCount = Math.max(Number(required.powerCount ?? 1), powerRooms)
  for (const [key, value] of Object.entries(required)) {
    if (value === undefined) continue
    const actual = config ? ratingFacilityValue(key, config) : null
    const levels = key === 'tradingLevel' ? config?.trading_station_levels : key === 'manufactureLevel' ? config?.manufacturing_station_levels : undefined
    const room = key === 'tradingLevel' ? 'trading' : 'manufacture'
    const needed = [...groups.values()].filter((group) => group.room === room).map((group) => Math.max(group.count, Number(value))).sort((a, b) => b - a)
    const orderedLevels = levels ? [...levels].sort((a, b) => b - a) : null
    const sufficient = orderedLevels && needed.length ? needed.every((level, index) => (orderedLevels[index] ?? 0) >= level) : actual !== null && (key === 'powerCountExact' ? actual === Number(value) : actual >= Number(value))
    conditions.push({ key, required: value, state: actual === null ? 'unknown' : sufficient ? 'ready' : 'blocked' })
  }
  const state: 'missing' | 'locked' | 'blocked' | 'unknown' | 'ready' = memberStates.includes('missing') ? 'missing' : memberStates.includes('locked') ? 'locked'
    : conditions.some((condition) => condition.state === 'blocked') ? 'blocked'
      : memberStates.includes('unknown') || conditions.some((condition) => condition.state === 'unknown') ? 'unknown' : 'ready'
  return { membersOwned, state, conditions }
}

function ratingFacilityValue(key: string, config: LicenseConfig): number | null {
  switch (key) {
    case 'tradingCount': return config.trading_stations_count
    case 'powerCount':
    case 'powerCountExact': return getFacilityIds(config).filter((id) => id.startsWith('power_')).length
    case 'tradingLevel': return config.trading_station_levels?.length ? Math.max(...config.trading_station_levels) : null
    case 'manufactureLevel': return config.manufacturing_station_levels?.length ? Math.max(...config.manufacturing_station_levels) : null
    case 'goldLines': return config.product_requirements.manufacturing_stations['Pure Gold'] ?? 0
    default: return null
  }
}

export function buildingRatingTrainingCost(member: RatingMember, roster: RatingRoster | null) {
  const owned = roster?.get(member.id)
  if (roster && !owned?.own) return null
  const currentElite = owned?.elite ?? 0
  const currentLevel = owned ? typeof owned.level === 'number' || typeof owned.level === 'string' ? Number(owned.level) : member.level === 1 && currentElite >= member.elite ? 1 : NaN : 1
  if (!Number.isInteger(currentElite) || !Number.isInteger(currentLevel) || currentLevel < 1) return null
  if (currentElite > member.elite || currentElite === member.elite && currentLevel >= member.level) return { lmd: 0, exp: 0 }
  return calculateTrainingCost({ rarity: rarities[member.id], currentElite, currentLevel, targetElite: member.elite, targetLevel: member.level })
}
