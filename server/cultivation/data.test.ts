import { describe, expect, it } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { prtsSnapshotSchema } from './catalog'
import { cultivationCosts } from './costs'
import { buildCultivationData } from './data'
import { readHomeworkRequirements } from './requirements'
import type { CultivationCurrent, CultivationTarget } from '../../src/lib/cultivation-contract'

const snapshot = () => prtsSnapshotSchema.parse(planningFixture())
const current: CultivationCurrent = { elite: 1, level: 2, skillLevel: 7, masteries: { s1: 1, s2: 0 }, modules: { mod_x: 1 }, potential: 1 }
const target: CultivationTarget = { elite: 2, level: 2, skill: 1, skillLevel: 9, moduleId: 'mod_x', moduleLevel: 2, potential: 1 }
const game = (elite = 1) => ({ data: { chars: [{ charId: 'char_test', evolvePhase: elite, level: 2, mainSkillLvl: 7, skills: [{ skillId: 's1', specializeLevel: 1 }], equip: [{ id: 'mod_x', level: 1 }], potentialRank: 0 }] } })
const pricing = { status: 'fresh' as const, prices: new Map([['rock', 5]]), fetched_at: '', age_ms: 0, snapshot_id: '', valuation_version: '' }

describe('PRTS and Skland cultivation data', () => {
  it('charges only missing levels, mastery of the selected skill, and ranks of the specified module', () => {
    const cost = cultivationCosts(snapshot(), 'char_test', current, target, 's1')
    expect(cost.warnings).toEqual(['养成材料表缺失'])
    const complete = snapshot()
    complete.costs.cultivate.test.evolve = [{ rock: 2 }, { rock: 3 }]
    const result = cultivationCosts(complete, 'char_test', current, target, 's1')
    expect(result).toEqual({ items: { '4001': 230, exp: 300, rock: 9 }, warnings: [] })
    expect(cultivationCosts(complete, 'char_test', { ...current, elite: 2, level: 3, masteries: { s1: 3 }, modules: { mod_x: 3 } }, target, 's1').items).toEqual({})
  })

  it('does not infer placeholder training or module ranks, and supports text requirements', () => {
    const result = readHomeworkRequirements({ opers: [{ name: '测试干员', requirements: { elite: 0, level: 0, skill_level: 0, potentiality: 0, module: -1 } }], doc: {} }, snapshot())
    expect(result.fixed[0].warnings).toEqual([])
    expect(result.fixed[0].target).toMatchObject({ elite: 0, level: 1, skillLevel: 1 })
    const fromText = readHomeworkRequirements({ opers: [{ name: '测试干员', skill: 1 }], doc: { details: '测试干员 精二2 专二 无模组' } }, snapshot())
    expect(fromText.fixed[0].target).toMatchObject({ elite: 2, level: 2, skillLevel: 9, moduleId: null })
    expect(fromText.fixed[0].warnings).toEqual([])
    const module = readHomeworkRequirements({ opers: [{ name: '测试干员', requirements: { elite: 2, level: 2, skill_level: 7, module: 1 } }] }, snapshot())
    expect(module.fixed[0].warnings).toEqual([])
    expect(module.fixed[0].target).toMatchObject({ elite: 2, level: 2, moduleId: 'mod_x', moduleLevel: 1 })
    const isolated = readHomeworkRequirements({ opers: [{ name: '测试干员' }, { name: '其他干员' }], doc: { details: '测试干员练度 精二2 专二 潜六' } }, snapshot())
    expect(isolated.fixed[0].target).toMatchObject({ elite: 2, level: 2, skillLevel: 9, potential: 6 })
    expect(isolated.fixed[1].warnings).toEqual([])
  })

  it('does not recommend alternatives when the player already meets a group option', () => {
    const input = snapshot()
    const op = input.homeworks[0].content.opers
    input.homeworks[0].content = { stage_name: 'main_01', opers: [], groups: [{ name: 'group', opers: op }] }
    const result = buildCultivationData(input, game(), { items: [] }, pricing)
    expect(result.candidates).toEqual([])
    expect(result.stats.owned).toBe(1)
  })

  it('extracts unlock conditions from old homework and module prerequisites from equip metadata', () => {
    const input = snapshot()
    input.operators.char_test.skills.push('s3')
    const old = readHomeworkRequirements({ opers: [{ name: '测试干员', skill: 2 }, { name: '测试干员', skill: 3 }] }, input)
    expect(old.fixed.map((row) => [row.target.elite, row.target.level, row.warnings])).toEqual([[1, 1, []], [2, 1, []]])
    input.costs.modules.equipDict.mod_x.typeName2 = 'X'
    input.costs.modules.equipDict.mod_x.uniEquipName = '测试模组'
    const module = readHomeworkRequirements({ opers: [{ name: '测试干员' }], doc: { details: '测试干员 X模组 3级模组' } }, input)
    expect(module.fixed[0].target).toMatchObject({ elite: 2, level: 2, moduleId: 'mod_x', moduleLevel: 3 })
    expect(module.fixed[0].warnings).toEqual([])
    input.homeworks[0].content = { opers: [{ name: '测试干员', skill: 2 }] }
    expect(buildCultivationData(input, game(), { items: [] }, pricing).candidates[0].satisfied).toBe(true)
  })

  it('keeps imported inventory and potion expiry separate, and flags missing current mastery', () => {
    const input = snapshot()
    input.homeworks[0].content.opers = [{ name: '测试干员', skill: 2, requirements: { elite: 2, level: 2, skill_level: 8, module: 0 } }]
    const result = buildCultivationData(input, game(), { items: [{ id: '2004', count: 3 }, { id: 'ap_supply_lt_60', count: 2, expireTs: 1791220800 }] }, pricing)
    expect(result.inventory.exp).toBe(6000)
    expect(result.inventory.ap_supply_lt_60).toBeUndefined()
    expect(result.potions[0]).toMatchObject({ count: 2, sanity: 60, expiresAt: '2026-10-05T17:20:00.000Z' })
    expect(result.candidates[0].warnings).toContain('森空岛未返回所选技能的专精等级')
  })

  it('uses cultivation training fields over the general player response, including known empty modules', () => {
    const input = snapshot()
    input.homeworks[0].content.opers = [{ name: '测试干员', skill: 1, requirements: { elite: 2, level: 2, skill_level: 10, module: 0 } }]
    const result = buildCultivationData(input, game(), { items: [], characters: [{ id: 'char_test', evolvePhase: 2, level: 3, mainSkillLevel: 7,
      skills: [{ id: 's1', level: 3 }, { id: 's2', level: 2 }], equips: [], potentialRank: 2 }] }, pricing)
    expect(result.candidates[0].current).toEqual({ elite: 2, level: 3, skillLevel: 7, masteries: { s1: 3, s2: 2 }, modules: {}, modulesKnown: true, potential: 3 })
    expect(result.candidates[0].satisfied).toBe(true)
    input.homeworks[0].content.opers[0].requirements.module = 1
    const withModule = buildCultivationData(input, game(), { items: [], characters: [{ id: 'char_test', equips: [] }] }, pricing)
    expect(withModule.candidates[0].items.rock).toBeGreaterThan(0)
    expect(withModule.candidates[0].warnings).not.toContain('森空岛未返回当前模组数据')
  })
})
