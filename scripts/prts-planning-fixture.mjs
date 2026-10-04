export function planningFixture() {
  return {
    version: 1, updatedAt: '2026-10-04T00:00:00.000Z', cursor: 20, reconcilePage: 1,
    homeworks: [{ id: 20, hash: 'hash', stageId: 'main_01', mode: 1, content: { stage_name: 'main_01', opers: [{ name: '测试干员', skill: 1, requirements: { elite: 1, level: 2, skill_level: 7, module: 0, potentiality: 1 } }] } }],
    operators: { char_test: { name: '测试干员', rarity: 4, skills: ['s1', 's2'] } },
    costs: {
      game_sha: 'a'.repeat(40),
      cultivate: { test: { evolve: [{ rock: 2 }], skills: { normal: Array.from({ length: 6 }, () => ({ book: 1 })), elite: [{ cost: [{ rock: 1 }, { rock: 2 }, { rock: 3 }] }, { cost: [{ rock: 2 }, { rock: 4 }, { rock: 6 }] }] } } },
      levels: { maxLevel: [[2], [2], [2, 2], [2, 2, 3]], characterExp: [[100], [200], [300, 400]], characterUpgradeCost: [[10], [20], [30, 40]], eliteCost: [[], [], [100], [100, 200]] },
      modules: { charEquip: { char_test: ['original', 'mod_x', 'mod_y'] }, equipDict: { mod_x: { charId: 'char_test', unlockEvolvePhase: 'PHASE_2', unlockLevel: 2, itemCost: { '1': [{ id: 'token', count: 1 }], '2': [{ id: 'rock', count: 4 }], '3': [{ id: 'rock', count: 6 }] } } } },
    },
    recipes: {}, farms: { rock: [{ stage: '1-7', sanity: 6, quantity: 1, days: [1, 2, 3, 4, 5, 6, 7] }] }, itemNames: { rock: '源岩', ap_supply_lt_60: '应急理智合剂' }, potionValues: { ap_supply_lt_60: 60 }, warnings: [],
  }
}
