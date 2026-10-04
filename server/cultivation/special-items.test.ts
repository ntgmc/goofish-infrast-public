import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { prtsSnapshotSchema } from './catalog'
import { readCultivationPlayer } from './player'
import { buildSpecialItemRecommendations, parseSpecialItemCatalog } from './special-items'
import { parseCultivationStatistics } from './references'

const training = (id: string, itemType: string, name = id) => ({ itemId: id, name, iconId: id, itemType, usage: '使用说明', description: '', rarity: 'TIER_5' })
const table = () => ({ items: {
  elite: training('elite', 'VOUCHER_ELITE_II_4'), level: training('level', 'VOUCHER_LEVELMAX_4'), mastery: training('mastery', 'VOUCHER_SKILL_SPECIALLEVELMAX_4'),
  selector: training('selector', 'VOUCHER_PICK'), random: training('random', 'VOUCHER_MGACHA'),
  materials: training('materials', 'MATERIAL_ISSUE_VOUCHER', '特级材料提货券'),
  '30014': { ...training('30014', 'MATERIAL', '提纯源岩'), rarity: 'TIER_4' },
  chipPack: training('chipPack', 'OPTIONAL_VOUCHER_PICK'),
  '3211': training('3211', 'MATERIAL', '先锋芯片'), '3212': training('3212', 'MATERIAL', '先锋芯片组'),
}, itemPackInfos: { pack: { content: [{ id: '3211', count: 5 }, { id: '3212', count: 8 }] } } })
const snapshot = () => prtsSnapshotSchema.parse(planningFixture())
const statistic = { charId: 'char_test', own: 200, sampleSize: 1000, elite: { 0: 20, 1: 20, 2: 160 },
  skill1: { 0: 100, 1: 20, 2: 30, 3: 50 }, skill2: { 0: 200 }, skill3: { 0: 200 },
  modX: { 0: 150, 1: 10, 2: 15, 3: 25 }, modY: { 0: 200 }, modD: { 0: 200 }, modA: { 0: 200 }, modB: { 0: 200 } }

describe('cultivation references and owned special items', () => {
  it('uses holder counts for training rates and rejects invalid distributions', () => {
    const rows = parseCultivationStatistics({ success: true, data: [statistic] })
    expect(rows.char_test).toMatchObject({ elite: [0.1, 0.1, 0.8], skills: [[0.5, 0.1, 0.15, 0.25], [1, 0, 0, 0], [1, 0, 0, 0]], modules: { X: [0.75, 0.05, 0.075, 0.125] } })
    expect(() => parseCultivationStatistics({ success: true, data: [{ ...statistic, elite: { 2: 201 } }] })).toThrow()
  })

  it('matches selector versions by item ID, preserves package quantities and excludes random packs', () => {
    const catalog = parseSpecialItemCatalog(table(), { old: '|itemId=other\n{{干员头像|未知干员}}', correct: '|itemId=selector\n{{干员头像|测试干员}}', pack: '|itemId=chipPack\n获得对应职业的芯片组合' }, snapshot().operators)
    expect(catalog.find((item) => item.id === 'selector')?.operators).toEqual(['char_test'])
    expect(catalog.find((item) => item.id === 'random')).toBeUndefined()
    expect(catalog.find((item) => item.id === 'materials')?.options).toEqual([{ key: '30014', name: '提纯源岩', items: { '30014': 1 } }])
    expect(catalog.find((item) => item.id === 'chipPack')?.options[0].items).toEqual({ '3211': 5, '3212': 8 })
  })

  it('resolves quoted sections and keeps standard and kernel selector pools separate', () => {
    const items = table()
    const value = { ...items, items: { ...items.items, selector: { ...items.items.selector, description: '范围包含『测试寻访』及过去的干员寻访池。' },
      voucher_class_pick1: training('voucher_class_pick1', 'VOUCHER_PICK'), quoted: { ...training('quoted', 'VOUCHER_PICK'), description: '从“测试干员”、“其他干员”两位干员中选择其一。' } } }
    const operators = { ...snapshot().operators, char_other: { name: '其他干员', rarity: 6, skills: ['other'] } }
    const pages = { standard: '|itemId=typo\n|描述=范围包含『测试寻访』及过去的干员寻访池。\n<section begin="pick"/>\n{|\n!标准寻访范围\n|{{干员头像|测试干员}}\n|}\n{|\n!中坚寻访范围\n|{{干员头像|其他干员}}\n|}\n<section end="pick"/>', kernel: '|itemId=voucher_class_pick1\n{{#lst:standard|pick}}' }
    const catalog = parseSpecialItemCatalog(value, pages, operators)
    expect(catalog.find((item) => item.id === 'selector')?.operators).toEqual(['char_test'])
    expect(catalog.find((item) => item.id === 'voucher_class_pick1')?.operators).toEqual(['char_other'])
    expect(catalog.find((item) => item.id === 'quoted')?.operators).toEqual(['char_test', 'char_other'])
  })

  it('reads owned counts and expiry, enforces voucher prerequisites, and computes remaining training costs', () => {
    const input = snapshot()
    input.costs.cultivate.test.evolve = [{ rock: 2 }, { rock: 3 }]
    const parsed = parseSpecialItemCatalog(table(), { selector: '|itemId=selector\n{{干员头像|测试干员}}' }, input.operators)
    const catalog = { parserVersion: 4 as const, status: 'fresh' as const, updatedAt: '2026-10-04T00:00:00Z', items: parsed, itemNames: {}, itemIcons: {}, excludedOperators: [], skillIcons: {} }
    const account = (elite: number, skill = 7) => readCultivationPlayer({ data: { chars: [{ charId: 'char_test', evolvePhase: elite, level: 1, mainSkillLvl: skill, skills: [{ skillId: 's1', specializeLevel: 1 }, { skillId: 's2', specializeLevel: 3 }], equip: [] }] } }, { items: [{ id: 'elite', count: 2 }, { id: 'level', count: 1 }, { id: 'mastery', count: 3 }, { id: 'selector', count: 1 }, { id: 'chipPack', count: 1, expireTs: 1 }] }, input)
    const demands = new Map([['char_test', { total: 10, elite: 6, skills: { 1: 4 } }]])
    const e1 = buildSpecialItemRecommendations(input, account(1), catalog, undefined, demands)
    expect(e1.find((item) => item.id === 'elite')).toMatchObject({ count: 2, recommendations: [{ demand: 6, items: { rock: 3, exp: 200, '4001': 220 } }] })
    expect(e1.find((item) => item.id === 'mastery')?.recommendations).toEqual([])
    expect(e1.find((item) => item.id === 'level')?.recommendations).toEqual([])
    const e2 = buildSpecialItemRecommendations(input, account(2), catalog, undefined, demands)
    expect(e2.find((item) => item.id === 'mastery')?.recommendations).toEqual([expect.objectContaining({ skill: 1, demand: 4, items: { rock: 5 } })])
    expect(e2.find((item) => item.id === 'elite')?.recommendations).toEqual([])
    expect(e2.find((item) => item.id === 'level')?.recommendations[0].items).toEqual({ exp: 700, '4001': 70 })
    expect(e2.find((item) => item.id === 'selector')?.recommendations[0].owned).toBe(true)
    expect(e2.find((item) => item.id === 'chipPack')?.available).toBe(false)
    expect(buildSpecialItemRecommendations(input, account(2, 6), catalog, undefined, demands).find((item) => item.id === 'mastery')?.recommendations).toEqual([])
    expect(buildSpecialItemRecommendations(input, account(2), { ...catalog, excludedOperators: ['char_test'] }, undefined, demands).find((item) => item.id === 'mastery')?.recommendations).toEqual([])
  })

  it('shares daily reference refreshes, persists validated public data and preserves caches on failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cultivation-reference-test-'))
    vi.resetModules()
    vi.stubEnv('MAA_PRTS_PLANNING_PATH', join(directory, 'snapshot.json'))
    const originalNow = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(originalNow)
    const remote = vi.fn(async (url: string) => {
      if (url.includes('ak-operator-statistics')) return Response.json({ success: true, data: [statistic] })
      if (url.includes('item_table.json')) return Response.json(table())
      if (url.includes('special_operator_table.json')) return Response.json({ operatorBasicData: { char_special: { soCharId: 'char_special' } } })
      if (url.includes('skill_table.json')) return Response.json({ s1: { iconId: 'common_icon' } })
      const query = new URL(url).searchParams
      if (query.get('action') === 'ask') return Response.json({ query: { meta: { count: 1 }, results: { 凭证: { printouts: { ItemId: ['selector'] } } } } })
      return Response.json({ query: { pages: { '1': { title: '凭证', revisions: [{ slots: { main: { '*': '|itemId=selector\n{{干员头像|测试干员}}' } } }] } } } })
    })
    vi.stubGlobal('fetch', remote)
    try {
      const { getSpecialItemCatalog } = await import('./special-items')
      const { getCultivationStatistics } = await import('./references')
      const [first, duplicate, statistics] = await Promise.all([getSpecialItemCatalog(snapshot().operators), getSpecialItemCatalog(snapshot().operators), getCultivationStatistics()])
      expect(first).toBe(duplicate)
      expect(first.status).toBe('fresh')
      expect(first.excludedOperators).toEqual(['char_special'])
      expect(first.skillIcons).toEqual({ s1: 'common_icon' })
      expect(first.itemIcons['30014']).toBe('30014')
      expect(statistics.operators.char_test.elite[2]).toBe(0.8)
      const saved = await readFile(join(directory, 'special-item-catalog.json'), 'utf8')
      expect(JSON.parse(saved).items.find((item: { id: string }) => item.id === 'selector').operators).toEqual(['char_test'])
      const calls = remote.mock.calls.length
      await Promise.all([getSpecialItemCatalog(snapshot().operators), getCultivationStatistics()])
      expect(remote).toHaveBeenCalledTimes(calls)
      now.mockReturnValue(originalNow + 2 * 86400000)
      remote.mockRejectedValue(new Error('offline'))
      expect((await getSpecialItemCatalog(snapshot().operators)).status).toBe('stale')
      expect((await getCultivationStatistics()).status).toBe('stale')
      expect(await readFile(join(directory, 'special-item-catalog.json'), 'utf8')).toBe(saved)
    } finally {
      now.mockRestore()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
