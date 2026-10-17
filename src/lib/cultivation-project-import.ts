import type { CultivationCandidate } from './cultivation-contract'
import { cultivationSatisfied } from './cultivation-target'
import { isCultivationProject, type CultivationProject } from './cultivation-projects'
import type { UpgradeSuggestion } from './types'

export type CultivationProjectScope = { userId: string; profileId: string }
const cultivationProjectStorageKey = ({ userId, profileId }: CultivationProjectScope) => `maatool:cultivation-projects:${userId}:${profileId}`
const changedEvent = 'maatool:cultivation-projects-changed'

export function readCultivationProjects(scope: CultivationProjectScope): CultivationProject[] {
  const saved: unknown = JSON.parse(localStorage.getItem(cultivationProjectStorageKey(scope)) ?? '[]')
  if (!Array.isArray(saved) || saved.length > 30 || !saved.every(isCultivationProject) || new Set(saved.map((row) => row.operatorId)).size !== saved.length) throw new Error('invalid_project_storage')
  return saved
}

export function saveCultivationProjects(scope: CultivationProjectScope, projects: CultivationProject[]): void {
  localStorage.setItem(cultivationProjectStorageKey(scope), JSON.stringify(projects))
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: cultivationProjectStorageKey(scope) }))
}

export function subscribeCultivationProjects(scope: CultivationProjectScope, refresh: () => void): () => void {
  const key = cultivationProjectStorageKey(scope)
  const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === key) refresh() }
  const stored = (event: StorageEvent) => { if ((event.key === key || event.key === null) && event.storageArea === localStorage) refresh() }
  window.addEventListener(changedEvent, changed)
  window.addEventListener('storage', stored)
  return () => { window.removeEventListener(changedEvent, changed); window.removeEventListener('storage', stored) }
}

export function mergeCultivationProjects(existing: CultivationProject[], incoming: CultivationProject[]) {
  const ids = new Set(existing.map((row) => row.operatorId))
  const added = incoming.filter((row) => {
    if (ids.has(row.operatorId)) return false
    ids.add(row.operatorId)
    return true
  })
  if (existing.length + added.length > 30) throw new Error('project_limit')
  return { projects: [...existing, ...added], added: added.length, kept: incoming.length - added.length }
}

export function projectFromCultivationCandidate(row: CultivationCandidate): CultivationProject | null {
  const target = { ...row.target, moduleId: null, moduleLevel: 0, potential: row.current.potential }
  if (row.warnings.length || cultivationSatisfied(row.current, target, row.skillId)) return null
  const elite = Math.max(target.elite, row.skillId ? target.skill - 1 : 0, target.skillLevel > 7 ? 2 : target.skillLevel > 4 ? 1 : 0)
  const project = { operatorId: row.operatorId, elite, level: elite === target.elite ? target.level : 1,
    skill: Math.max(1, target.skill), skillLevel: target.skillLevel, paused: false, deadline: '' }
  return isCultivationProject(project) ? project : null
}

export function projectsFromUpgradeSuggestion(suggestion: UpgradeSuggestion): CultivationProject[] {
  const operators = suggestion.type === 'bundle' ? suggestion.ops ?? [] : [suggestion]
  const projects = operators.map((operator) => {
    const cost = suggestion.training_cost?.operators.find((row) => row.id === operator.id)
    const elite = operator.target_elite ?? operator.target ?? cost?.target_elite
    return { operatorId: operator.id ?? '', elite: elite ?? -1,
      level: cost && cost.target_elite === elite ? cost.target_level : 1, skill: 1, skillLevel: 1, paused: false, deadline: '' }
  })
  return projects.length && projects.every(isCultivationProject) && new Set(projects.map((row) => row.operatorId)).size === projects.length ? projects : []
}
