import { describe, expect, it } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { buildProjectRoute, type CultivationProject } from '../../src/lib/cultivation-projects'
import { prtsSnapshotSchema } from './catalog'
import { buildCultivationProjects } from './projects'

const project: CultivationProject = { operatorId: 'char_test', elite: 2, level: 2, skill: 1, skillLevel: 9, paused: false, deadline: '' }
const pricing = { status: 'fresh' as const, prices: new Map([['rock', 5]]), fetched_at: '', age_ms: 0, snapshot_id: '', valuation_version: '' }
const game = { data: { chars: [{ charId: 'char_test', evolvePhase: 1, level: 2, mainSkillLvl: 7, skills: [{ skillId: 's1', specializeLevel: 1 }], equip: [], potentialRank: 0 }] } }

describe('player-selected cultivation targets', () => {
  it('provides all owned operators without homework or community evidence and costs the exact requested target', () => {
    const snapshot = prtsSnapshotSchema.parse(planningFixture())
    snapshot.homeworks = []
    snapshot.itemIcons = { rock: 'MTL_ROCK' }
    snapshot.costs.cultivate.test.evolve = [{ rock: 2 }, { rock: 3 }]
    const empty = buildCultivationProjects(snapshot, game, { items: [{ id: '2004', count: 2 }] }, pricing, [])
    expect(empty.candidates).toEqual([])
    expect(empty.projectOperators).toMatchObject([{ id: 'char_test', current: { elite: 1, level: 2 } }])
    expect(empty.inventory.exp).toBe(4000)
    const result = buildCultivationProjects(snapshot, game, { items: [] }, pricing, [project])
    expect(result.candidates).toMatchObject([{ operatorId: 'char_test', source: 'project', items: { exp: 300, '4001': 230, rock: 5 }, warnings: [] }])
    expect(result.candidates[0].target).toMatchObject({ elite: 2, level: 2, skillLevel: 9, moduleId: null })
    expect(result.recommendation).toBeUndefined()
    expect(result.itemIcons).toEqual({ rock: 'MTL_ROCK' })
  })

  it('routes chip catalysts through voucher farming even when the imported snapshot lacks that source', () => {
    const snapshot = prtsSnapshotSchema.parse(planningFixture())
    snapshot.costs.cultivate.test.evolve = [{}, { '32001': 1 }]
    delete snapshot.farms['4006']
    const goal = { ...project, level: 1, skillLevel: 7 }
    const result = buildCultivationProjects(snapshot, game, { items: [{ id: '2004', count: 10 }, { id: '4001', count: 10000 }] }, pricing, [goal])
    const settings = { startDate: '2026-10-06', dailySanity: 150, days: 7, allOpen: false }
    const route = buildProjectRoute(result, [goal], settings, null)
    expect(route.missing).toEqual({ '4006': 90 })
    expect(route.phases[0].farms).toEqual([])
    expect(route.phases[1].farms).toEqual([])
    expect(route.phases[2].farms).toEqual([{ item: '4006', stage: 'AP-5', runs: 5, quantity: 105 }])
    expect(route.readyDate).toBe('2026-10-08')
    expect(route.blocked).toEqual([])
    expect(snapshot.farms['4006']).toBeUndefined()
    snapshot.farms['4006'] = [{ stage: 'known-source', sanity: 1, quantity: 90, days: [2] }]
    const known = buildCultivationProjects(snapshot, game, { items: [] }, pricing, [])
    expect(known.farms['4006']).toEqual(snapshot.farms['4006'])
  })

  it('rejects foreign operators, unattainable levels and nonexistent skills', () => {
    const snapshot = prtsSnapshotSchema.parse(planningFixture())
    for (const invalid of [{ operatorId: 'foreign' }, { elite: 2, level: 90 }, { skill: 3 }]) {
      expect(() => buildCultivationProjects(snapshot, game, { items: [] }, pricing, [{ ...project, ...invalid }])).toThrow()
    }
  })
})
