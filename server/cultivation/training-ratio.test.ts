import { expect, it } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { prtsSnapshotSchema } from './catalog'
import { buildTrainingAccountData } from './training-ratio'
import { accountTrainingRequirements, defaultTrainingSettings } from '../../src/lib/training-ratio-account'

it('counts shared alternate-form levels once and retains each owned form module', () => {
  const snapshot = prtsSnapshotSchema.parse(planningFixture())
  snapshot.operators.char_form = { ...snapshot.operators.char_test, baseId: 'char_test' }
  snapshot.costs.modules = { charEquip: { char_test: ['x'], char_form: ['y'] }, equipDict: {
    x: { typeName2: 'X', unlockLevel: 2, itemCost: { '1': [{ id: '4001', count: 80000 }] } },
    y: { typeName2: 'Y', unlockLevel: 2, itemCost: { '1': [{ id: '4001', count: 70000 }] } },
  } }
  const game = { chars: [
    { charId: 'char_test', evolvePhase: 1, level: 1, equip: [{ equipId: 'x', level: 1 }] },
    { charId: 'char_form', evolvePhase: 1, level: 2, equip: [] },
  ] }
  const data = buildTrainingAccountData(snapshot, game, { items: [] }, undefined)
  expect(data.operators).toHaveLength(1)
  expect(data.operators[0]).toMatchObject({ id: 'char_test', elite: 1, level: 2, modules: [{ id: 'x', current: 1 }, { id: 'y', current: 0 }] })
  const result = accountTrainingRequirements({ ...data, snapshotVersion: '1', importedAt: '' }, { ...defaultTrainingSettings, four: 'max', modules: 'all', moduleLevel: 1 })
  expect(result.issues).toEqual([])
  expect(result.moduleLmd).toBe(70000)
  expect(result.lmd).toBe(70270)
  expect(result.exp).toBe(700)
  const variantOnly = buildTrainingAccountData(snapshot, { chars: [game.chars[1]] }, { items: [] }, undefined)
  expect(variantOnly.operators).toMatchObject([{ id: 'char_test', level: 2, modules: [{ id: 'y' }] }])
  snapshot.operators.char_other = { ...snapshot.operators.char_test }
  const sameName = buildTrainingAccountData(snapshot, { chars: [...game.chars, { ...game.chars[0], charId: 'char_other' }] }, { items: [] }, undefined)
  expect(sameName.operators).toHaveLength(2)
})

it('joins owned training, module costs and community references without requiring homework', () => {
  const snapshot = prtsSnapshotSchema.parse(planningFixture())
  snapshot.homeworks = []
  snapshot.costs.modules = { charEquip: { char_test: ['initial', 'x', 'y'] }, equipDict: {
    initial: { type: 'INITIAL' },
    x: { charId: 'char_test', uniEquipName: '测试模组', typeName2: 'X', unlockLevel: 1, itemCost: { '1': [{ id: '4001', count: 80000 }], '2': [{ id: '4001', count: 100000 }], '3': [{ id: '4001', count: 120000 }] } },
    y: { charId: 'char_test', typeName2: 'Y', unlockLevel: 1, itemCost: { '1': [{ id: '4001', count: -1 }] } },
  } }
  const game = { chars: [{ charId: 'char_test', evolvePhase: 1, level: 1, equip: [{ equipId: 'x', level: 1 }] }] }
  const community = { status: 'fresh' as const, updatedAt: '', operators: { char_test: { owned: 200, sampleSize: 300, elite: [], skills: [], modules: { X: [0.2, 0.3, 0.2, 0.3], Y: [0.9, 0.1, 0, 0] } } } }
  const data = buildTrainingAccountData(snapshot, game, { items: [{ id: '2004', count: 2 }, { id: '4001', count: 500 }] }, community)
  expect(data.inventory).toEqual({ lmd: 500, exp: 4000 })
  expect(data.operators[0].modules).toMatchObject([{ id: 'x', current: 1, common: true, costs: [80000, 100000, 120000] }, { id: 'y', common: false, costs: [null, null, null] }])
  const cost = accountTrainingRequirements({ ...data, snapshotVersion: '1', importedAt: '' }, { ...defaultTrainingSettings, four: 'max', modules: 'common', moduleLevel: 3 })
  expect(cost.moduleLmd).toBe(220000)
  expect(cost.issues).toEqual([])
  const unknown = buildTrainingAccountData(snapshot, { chars: [{ charId: 'char_test', evolvePhase: 1, level: 1 }] }, { items: [] }, undefined)
  expect(unknown.operators[0].modules).toMatchObject([{ current: null, common: null }, { current: null, common: null }])
  expect(() => buildTrainingAccountData(snapshot, { chars: [{ charId: 'char_new', evolvePhase: 0, level: 1 }] }, { items: [] }, community)).toThrow('部分已持有干员的培养资料暂不可用')
  delete snapshot.costs.modules.equipDict.x
  expect(() => buildTrainingAccountData(snapshot, game, { items: [] }, community)).toThrow('模组资料不完整')
})
