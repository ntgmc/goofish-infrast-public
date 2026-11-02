import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMaterialDemand, parseOperatorReleaseDates } from './material-demand-lib.mjs'

const row = (name, rarity, date) => `<tr><td><a>${name}</a></td><td>${rarity}</td><td>${date}</td></tr>`
const item = (name, rarity) => ({ name, rarity, iconId: name })
const cost = (id, count) => ({ id, count })
const operator = { name: '测试干员', rarity: 'TIER_6', isNotObtainable: false,
  phases: [{ evolveCost: null }, { evolveCost: [cost('30012', 5)] }],
  allSkillLvlup: [{ lvlUpCost: [cost('30013', 1)] }],
  skills: [{ levelUpCostCond: [{ levelUpCost: [cost('30014', 1)] }] }, { levelUpCostCond: [{ levelUpCost: [cost('30115', 1)] }] }],
}
const fixture = () => ({
  character_table: { char_test: operator, char_temporary: { ...operator, name: '临时干员', isNotObtainable: true } },
  char_patch_table: { patchChars: { char_form: { ...operator, skills: [{ levelUpCostCond: [{ levelUpCost: [cost('30013', 2)] }] }] } }, patchDetailInfoList: { char_form: { infoParam: '近卫' } } },
  item_table: { items: { '30011': item('源岩', 'TIER_1'), '30012': item('固源岩', 'TIER_2'), '30013': item('固源岩组', 'TIER_3'), '30014': item('提纯源岩', 'TIER_4'), '30023': item('糖组', 'TIER_3'), '30115': item('聚合剂', 'TIER_5') } },
  building_data: { workshopFormulas: {
    green: { formulaType: 'F_EVOLVE', itemId: '30012', count: 1, costs: [cost('30011', 3)] },
    blue: { formulaType: 'F_EVOLVE', itemId: '30013', count: 1, costs: [cost('30012', 5)] },
    purple: { formulaType: 'F_EVOLVE', itemId: '30014', count: 1, costs: [cost('30013', 4)] },
    gold: { formulaType: 'F_EVOLVE', itemId: '30115', count: 1, costs: [cost('30014', 2), cost('30023', 3)] },
  } },
  uniequip_table: { equipDict: {
    module: { charId: 'char_test', uniEquipName: '新模组', uniEquipGetTime: Date.parse('2022-06-01T16:00:00+08:00') / 1000, itemCost: { 1: [cost('30014', 1)], 2: [cost('30023', 2)], 3: [cost('30115', 1)] } },
    original: { charId: 'char_test', uniEquipName: '原始证章', uniEquipGetTime: 1, itemCost: null },
  } },
})
const html = row('测试干员', 6, '2020年1月1日 16:00') + row('测试干员(近卫)', 6, '2021年1月1日 16:00')
const metadata = { gameSha: 'a'.repeat(40), asOf: '2026-11-02', releaseDatesSha256: 'b'.repeat(64) }

test('expands all promotions, skill ranks and every mastery; adds all module levels on module release day', () => {
  const result = buildMaterialDemand(fixture(), html, metadata)
  assert.deepEqual(result.materials.map((x) => x.id), ['30013', '30023'])
  assert.deepEqual(result.operators.map((x) => [x.id, x.amounts]), [['char_test', [14, 3]], ['char_form', [2, 0]]])
  assert.deepEqual(result.modules.map((x) => [x.date, x.amounts]), [['2022-06-01', [12, 5]]])
})

test('keeps low-star and zero-material events, excludes future content, and uses China dates for modules', () => {
  const tables = fixture()
  tables.character_table.char_low = { ...operator, name: '低星', rarity: 'TIER_1', phases: [], skills: [], allSkillLvlup: [] }
  tables.uniequip_table.equipDict.module.uniEquipGetTime = Date.parse('2026-11-02T20:00:00Z') / 1000
  const result = buildMaterialDemand(tables, html + row('低星', 1, '2020年1月2日'), metadata)
  assert.equal(result.operators.find((x) => x.id === 'char_low').amounts.reduce((a, b) => a + b), 0)
  assert.deepEqual(result.modules, [])
})

test('rejects incomplete dates, inconsistent dates, missing recipes, cycles and malformed external costs', () => {
  assert.throws(() => buildMaterialDemand(fixture(), row('未知', 6, '2020年1月1日'), metadata), /Missing operator release/)
  assert.throws(() => parseOperatorReleaseDates(html + row('测试干员', 6, '2020年2月1日')), /Conflicting/)
  const tables = fixture()
  delete tables.building_data.workshopFormulas.gold
  assert.throws(() => buildMaterialDemand(tables, html, metadata), /Missing material recipe/)
  tables.building_data.workshopFormulas.gold = { formulaType: 'F_EVOLVE', itemId: '30115', count: 1, costs: [cost('30115', 1)] }
  assert.throws(() => buildMaterialDemand(tables, html, metadata), /Cyclic/)
  const invalid = fixture()
  invalid.character_table.char_test.phases = [{ evolveCost: [cost('30013', -1)] }]
  assert.throws(() => buildMaterialDemand(invalid, html, metadata), /Too small/)
})
