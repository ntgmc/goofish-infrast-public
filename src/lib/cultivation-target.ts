import type { CultivationCurrent, CultivationTarget } from './cultivation-contract'

export function cultivationSatisfied(current: CultivationCurrent, target: CultivationTarget, skillId: string) {
  return (current.elite > target.elite || (current.elite === target.elite && current.level >= target.level))
    && (target.skillLevel <= 1 || (current.skillLevel !== null && current.skillLevel >= Math.min(7, target.skillLevel)))
    && (target.skillLevel <= 7 || (current.masteries[skillId] ?? -1) >= target.skillLevel - 7)
    && (!target.moduleId || (current.modulesKnown !== false && (current.modules[target.moduleId] ?? 0) >= (target.moduleLevel ?? 1)))
    && current.potential >= target.potential
}

export function cultivatedCurrent(current: CultivationCurrent, target: CultivationTarget, skillId: string): CultivationCurrent {
  return {
    ...current,
    elite: Math.max(current.elite, target.elite),
    level: current.elite > target.elite ? current.level : current.elite === target.elite ? Math.max(current.level, target.level) : target.level,
    skillLevel: Math.max(current.skillLevel ?? 1, Math.min(7, target.skillLevel)),
    masteries: { ...current.masteries, ...(target.skillLevel > 7 ? { [skillId]: Math.max(current.masteries[skillId] ?? 0, target.skillLevel - 7) } : {}) },
    modules: { ...current.modules, ...(target.moduleId ? { [target.moduleId]: Math.max(current.modules[target.moduleId] ?? 0, target.moduleLevel ?? 1) } : {}) },
    potential: Math.max(current.potential, target.potential),
  }
}
