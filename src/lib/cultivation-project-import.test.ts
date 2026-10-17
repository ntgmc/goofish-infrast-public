import { describe, expect, it } from 'vitest'
import type { CultivationCandidate } from './cultivation-contract'
import type { CultivationProject } from './cultivation-projects'
import { mergeCultivationProjects, projectFromCultivationCandidate, projectsFromUpgradeSuggestion } from './cultivation-project-import'
import type { UpgradeSuggestion, UpgradeTrainingOperatorCost } from './types'

const goal = (operatorId: string): CultivationProject => ({ operatorId, elite: 2, level: 60, skill: 1, skillLevel: 7, paused: false, deadline: '' })
const candidate = (): CultivationCandidate => ({
  key: 'test', operatorId: 'char_test', name: '测试干员', skillId: 's3', items: {}, warnings: [], satisfied: false,
  frequency: 1, fixedFrequency: 1, stageCount: 1, examples: [],
  current: { elite: 1, level: 80, skillLevel: 7, masteries: { s3: 0 }, modules: {}, potential: 1 },
  target: { elite: 2, level: 60, skill: 3, skillLevel: 10, moduleId: null, moduleLevel: 0, potential: 1 },
})

describe('cultivation suggestion imports', () => {
  it('preserves exact level and mastery targets and adds required elite unlock stages', () => {
    expect(projectFromCultivationCandidate(candidate())).toEqual({ ...goal('char_test'), skill: 3, skillLevel: 10 })
    const row = candidate()
    row.target = { ...row.target, elite: 0, level: 50 }
    expect(projectFromCultivationCandidate(row)).toMatchObject({ elite: 2, level: 1, skill: 3, skillLevel: 10 })
  })

  it('imports only actionable supported training, without converting module-only or incomplete suggestions into empty goals', () => {
    const row = candidate()
    row.target.moduleId = 'mod_x'
    row.target.potential = 6
    expect(projectFromCultivationCandidate(row)).toMatchObject({ level: 60, skillLevel: 10 })
    row.current = { ...row.current, elite: 2, level: 90, masteries: { s3: 3 } }
    expect(projectFromCultivationCandidate(row)).toBeNull()
    row.current.elite = 1
    row.warnings = ['练度数据不完整']
    expect(projectFromCultivationCandidate(row)).toBeNull()
  })

  it('converts single and bundle base upgrades, using explicit training target levels when provided', () => {
    const single: UpgradeSuggestion = { type: 'single', id: 'char_a', target: 2, gain: 1 }
    expect(projectsFromUpgradeSuggestion(single)).toEqual([{ ...goal('char_a'), level: 1, skillLevel: 1 }])
    const bundle: UpgradeSuggestion = { type: 'bundle', gain: 1, ops: [{ id: 'char_a', name: 'A', target_elite: 2 }, { id: 'char_b', name: 'B', target: 1 }] }
    expect(projectsFromUpgradeSuggestion(bundle)).toEqual([{ ...goal('char_a'), level: 1, skillLevel: 1 }, { ...goal('char_b'), elite: 1, level: 1, skillLevel: 1 }])
    single.training_cost = { operators: [{ id: 'char_a', target_elite: 2, target_level: 50 } as UpgradeTrainingOperatorCost] } as NonNullable<UpgradeSuggestion['training_cost']>
    expect(projectsFromUpgradeSuggestion(single)[0]).toMatchObject({ elite: 2, level: 50 })
    single.target = 1
    expect(projectsFromUpgradeSuggestion(single)[0]).toMatchObject({ elite: 1, level: 1 })
  })

  it('rejects unresolved and invalid upgrade goals as a whole rather than partially importing a bundle', () => {
    for (const suggestion of [
      { type: 'single', id: 'char_a' }, { type: 'single', id: 'char_a', target: 3 },
      { type: 'bundle', ops: [{ id: 'char_a', name: 'A', target: 2 }, { name: 'B', target: 2 }] },
      { type: 'bundle', ops: [{ id: 'char_a', name: 'A', target: 2 }, { id: 'char_a', name: 'A', target: 1 }] },
    ]) expect(projectsFromUpgradeSuggestion({ ...suggestion, gain: 1 } as UpgradeSuggestion)).toEqual([])
  })

  it('preserves manual priorities, deadlines and pauses, deduplicates imports, and rejects overflow atomically', () => {
    const existing = [{ ...goal('char_a'), paused: true, deadline: '2026-11-01' }]
    const incoming = [goal('char_a'), goal('char_b'), goal('char_b')]
    expect(mergeCultivationProjects(existing, incoming)).toEqual({ projects: [...existing, goal('char_b')], added: 1, kept: 2 })
    expect(existing).toHaveLength(1)
    expect(incoming).toHaveLength(3)
    const full = Array.from({ length: 30 }, (_, index) => goal(`char_${index}`))
    expect(() => mergeCultivationProjects(full, [goal('new')])).toThrow('project_limit')
    expect(mergeCultivationProjects(full, [goal('char_0')]).added).toBe(0)
    expect(full).toHaveLength(30)
  })
})
