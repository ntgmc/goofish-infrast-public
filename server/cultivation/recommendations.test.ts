import { describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { prtsSnapshotSchema, type PrtsSnapshot } from './catalog'
import { calculateCultivationRecommendations, getCultivationRecommendations } from './recommendations'
import { readHomeworkRequirements } from './requirements'

const now = Date.parse('2026-10-08T12:00:00Z')
type Homework = PrtsSnapshot['homeworks'][number]
const ago = (days: number) => new Date(now - days * 86400000).toISOString()
function job(id: number, changes: Partial<Homework> = {}): Homework {
  return { ...prtsSnapshotSchema.parse(planningFixture()).homeworks[0], id, stageId: `main_${id % 2}`, uploadedAt: ago(7),
    content: { opers: [{ name: '测试干员', skill: 1, requirements: { elite: 1, level: 2, skill_level: 7, module: 0 } }],
      actions: [{ type: 'Deploy', name: '测试干员', location: [id, 0], direction: 'Right' }] }, ...changes }
}
function snapshot(homeworks: Homework[]) { return prtsSnapshotSchema.parse({ ...planningFixture(), homeworks }) }
const observing = { ...defaultCultivationQuery, includeUncertain: true }
const weights = (input: PrtsSnapshot) => new Map(calculateCultivationRecommendations(input, observing, now).recommendations.flatMap((row) => row.samples.map((sample) => [sample.document.homework.id, sample.weight] as const)))

describe('independent cultivation recommendation evidence', () => {
  it('caps copies, ignores prose, preserves the earliest publication, and keeps delay variants own feedback', () => {
    const originals = [job(1), job(2), job(3)]
    const base = calculateCultivationRecommendations(snapshot(originals), defaultCultivationQuery, now)
    const copies = Array.from({ length: 20 }, (_, index) => ({ ...originals[0], id: 100 + index, uploadedAt: ago(0),
      content: { ...originals[0].content, doc: { title: '改标题', details: '改说明' } } }))
    const copied = calculateCultivationRecommendations(snapshot([...originals, ...copies]), defaultCultivationQuery, now)
    expect(copied.families).toBe(base.families)
    expect(copied.recommendations[0].evidence).toEqual(base.recommendations[0].evidence)
    expect(copied.recommendations[0].samples.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(base.recommendations[0].samples.reduce((sum, row) => sum + row.weight, 0))
    const variant = { ...originals[0], id: 201, likes: 0, dislikes: 100, content: { ...originals[0].content,
      actions: [{ type: 'Deploy', name: '测试干员', location: [1, 0], direction: 'Right', pre_delay: 1000 }] } }
    const revised = calculateCultivationRecommendations(snapshot([...originals, variant]), defaultCultivationQuery, now)
    expect(revised.families).toBe(3)
    expect(revised.recommendations[0].samples.some((row) => row.document.homework.id === 201)).toBe(false)
    expect(revised.recommendations[0].evidence.families).toBe(3)
  })

  it('does not rejuvenate historical strategies through reuploads and makes history explicitly selectable', () => {
    const old = job(1, { uploadedAt: ago(700) })
    const input = snapshot([old, { ...old, id: 2, uploadedAt: ago(1) }])
    expect(calculateCultivationRecommendations(input, defaultCultivationQuery, now).recommendations).toEqual([])
    const history = calculateCultivationRecommendations(input, { ...defaultCultivationQuery, scope: 'history', days: 0 }, now)
    expect(history.recommendations[0].evidence).toMatchObject({ status: 'historical', families: 1, recentFamilies: 0 })
    expect(history.recommendations[0].samples[0].document.homework.id).toBe(1)
  })

  it('uses rating uncertainty, excludes established poor feedback despite views, and bounds exposure', () => {
    const rows = [job(1), job(2, { likes: 1, dislikes: 0 }), job(3, { likes: 10, dislikes: 90, views: 1e9 }), job(4, { likes: 0, dislikes: 0 }), job(5, { views: 1e9 })]
    rows.forEach((row) => { row.stageId = 'main_1' })
    const result = weights(snapshot(rows))
    expect(result.get(1)).toBeGreaterThan(result.get(2)!)
    expect(result.get(3)).toBeUndefined()
    expect(result.get(4)).toBeGreaterThan(0)
    expect(result.get(5)! / result.get(1)!).toBeLessThanOrEqual(1.1 + 1e-9)
    const ordinary = calculateCultivationRecommendations(snapshot(rows), { ...defaultCultivationQuery, stageId: 'main_1' }, now)
    expect(ordinary.recommendations.flatMap((row) => row.samples).some((row) => row.document.homework.id === 4)).toBe(false)
  })

  it('lets independent feedback on quiet stages qualify and balances activity/stage budgets', () => {
    const rows = [job(1, { likes: 8, dislikes: 0, views: 10 }), job(2, { likes: 8, dislikes: 0, views: 5 }), job(3, { likes: 8, dislikes: 0, views: 2 })]
    const input = snapshot(rows)
    input.stages = { main_1: { name: '1-1', activity: '第一章', category: '主线', permanent: true }, main_0: { name: '1-2', activity: '第一章', category: '主线', permanent: true } }
    const result = calculateCultivationRecommendations(input, defaultCultivationQuery, now)
    expect(result.recommendations[0].evidence).toMatchObject({ status: 'current', families: 3, recentStages: 2 })
    const stageWeight = (stage: string) => result.recommendations[0].samples.filter((row) => row.document.homework.stageId === stage).reduce((sum, row) => sum + row.weight, 0)
    expect(stageWeight('main_1') / stageWeight('main_0')).toBeGreaterThanOrEqual(0.9)
    expect(stageWeight('main_1') / stageWeight('main_0')).toBeLessThanOrEqual(1.1)
  })

  it('splits one alternative position, retains unresolved shares, and supports focused or closed content', () => {
    const input = snapshot([job(1, { stageId: 'activity_test', content: { groups: [{ name: '选择', opers: [{ name: '测试干员', skill: 1, requirements: { elite: 1, level: 2 } }, { name: '未知干员' }] }] } })])
    input.stages = { activity_test: { name: '测试-1', category: '活动', activity: '测试活动', permanent: false, open: false } }
    const query = { ...defaultCultivationQuery, stageId: 'activity_test', includeClosed: true }
    expect(calculateCultivationRecommendations(input, defaultCultivationQuery, now).recommendations).toEqual([])
    const result = calculateCultivationRecommendations(input, query, now)
    expect(result.recommendations[0].samples[0].share).toBe(0.5)
    expect(result.recommendations[0].evidence.status).toBe('current')
    expect(calculateCultivationRecommendations(input, { ...query, includeAlternatives: false }, now).recommendations).toEqual([])
  })

  it('preserves skill/module branches and joint coverage instead of forcing the highest requirements', () => {
    const low = job(1)
    const high = job(2, { likes: 1, dislikes: 1, content: { ...job(2).content, opers: [{ name: '测试干员', skill: 1, requirements: { elite: 2, level: 3, skill_level: 10 } }] } })
    const module = job(3, { content: { ...job(3).content, opers: [{ name: '测试干员', skill: 2, requirements: { elite: 2, level: 2, skill_level: 7, module: 1 } }] } })
    const result = calculateCultivationRecommendations(snapshot([low, high, module]), defaultCultivationQuery, now)
    expect(result.recommendations).toHaveLength(2)
    expect(result.recommendations.find((row) => row.target.skill === 1)?.target).toMatchObject({ elite: 1, level: 2, skillLevel: 7 })
    expect(result.recommendations.find((row) => row.target.skill === 2)?.target).toMatchObject({ elite: 2, moduleId: 'mod_x', moduleLevel: null })
    expect(result.recommendations.every((row) => row.evidence.coverage >= 0.8)).toBe(true)
  })

  it('resolves professions and v3 module types independently of equip order and keeps unknown fields incomplete', () => {
    const input = snapshot([job(1)])
    input.operators.char_test.profession = 'WARRIOR'
    input.operators.char_other = { ...input.operators.char_test, profession: 'CASTER' }
    input.costs.modules.equipDict.mod_x.typeName2 = 'X'
    input.costs.modules.charEquip.char_test = ['original', 'mod_y', 'mod_x']
    const parsed = readHomeworkRequirements({ version: 3, opers: [{ name: '测试干员', role: 'Warrior', skill: 1, requirements: { module: 1 } }, { name: '测试干员' }] }, input)
    expect(parsed.fixed[0].operator?.id).toBe('char_test')
    expect(parsed.fixed[0].target).toMatchObject({ moduleId: 'mod_x', moduleLevel: null })
    expect(parsed.fixed[0].specified).toEqual({ training: false, skill: false, module: true })
    expect(parsed.fixed[1].operator).toBeUndefined()
    const invalid = readHomeworkRequirements({ opers: [{ name: '测试干员', role: 'Warrior', requirements: { elite: -1 } }] }, input)
    expect(invalid.fixed[0].warnings).toContain('作业练度字段无效')
  })

  it('invalidates public recommendations for a replaced snapshot and supports skill-less operators', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const input = snapshot([job(1)])
    input.operators.char_test.skills = []
    const query = { ...defaultCultivationQuery, stageId: 'main_1' }
    const first = getCultivationRecommendations(input, query)
    expect(first.recommendations[0].target).toMatchObject({ skill: 0, skillLevel: 1 })
    expect(getCultivationRecommendations(input, query)).toBe(first)
    expect(getCultivationRecommendations({ ...input, homeworks: [] }, query).recommendations).toEqual([])
    clock.mockReturnValue(now + 16 * 60000)
    expect(getCultivationRecommendations(input, query)).not.toBe(first)
  })
})
