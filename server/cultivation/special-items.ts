import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { CultivationData, CultivationSpecialItem } from '../../src/lib/cultivation-contract'
import { asRecord, asRows, prtsSnapshotPath, type PrtsSnapshot } from './catalog'
import { fetchCultivationJson, saveCultivationReference } from './references'
import { cultivationCosts } from './costs'
import type { readCultivationPlayer } from './player'

const itemSchema = z.object({ itemId: z.string(), name: z.string(), iconId: z.string().nullable().transform((value) => value ?? ''), itemType: z.string(), rarity: z.string(), usage: z.string().nullable().transform((value) => value ?? ''), description: z.string().nullable().transform((value) => value ?? '') })
const gameSchema = z.object({ items: z.record(z.string(), itemSchema), itemPackInfos: z.record(z.string(), z.object({ content: z.array(z.object({ id: z.string(), count: z.number().int().positive() })) })) })
type CatalogItem = Omit<CultivationSpecialItem, 'count' | 'expiresAt' | 'available' | 'recommendations'> & { rarity: number | null; operators: string[]; options: Array<{ key: string; name: string; items: Record<string, number> }> }
const catalogItemSchema = z.object({ id: z.string(), name: z.string(), iconId: z.string(), kind: z.enum(['elite', 'level', 'mastery', 'selector', 'materials']), scope: z.string(), sourceUrl: z.string(), rarity: z.number().int().min(1).max(6).nullable(), operators: z.array(z.string()), options: z.array(z.object({ key: z.string(), name: z.string(), items: z.record(z.string(), z.number().positive()) })) })
const savedSchema = z.object({ parserVersion: z.literal(4), updatedAt: z.string().datetime(), items: z.array(catalogItemSchema), itemNames: z.record(z.string(), z.string()), itemIcons: z.record(z.string(), z.string()), excludedOperators: z.array(z.string()), skillIcons: z.record(z.string(), z.string()) })
type Catalog = z.infer<typeof savedSchema> & { status: 'fresh' | 'stale' | 'unavailable' }
let cache: Catalog | null = null
let nextAttempt = 0
let pending: Promise<Catalog> | null = null

function resolvePage(title: string, pages: Record<string, string>, seen = new Set<string>()): string {
  if (seen.has(title) || seen.size >= 5) return ''
  const next = new Set(seen).add(title)
  return (pages[title] ?? '').replace(/\{\{#lst:([^|{}]+)\|([^{}]+)\}\}/g, (_match, page: string, section: string) => {
    const text = resolvePage(page.trim(), pages, next)
    const escaped = section.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const begin = text.match(new RegExp(`<section\\s+begin=["']${escaped}["']\\s*/>`))
    const end = text.match(new RegExp(`<section\\s+end=["']${escaped}["']\\s*/>`))
    return begin?.index !== undefined && end?.index !== undefined ? text.slice(begin.index + begin[0].length, end.index) : ''
  })
}

export function parseSpecialItemCatalog(value: unknown, pages: Record<string, string>, operators: PrtsSnapshot['operators']): CatalogItem[] {
  const table = gameSchema.parse(value)
  const byName = new Map(Object.entries(operators).map(([id, operator]) => [operator.name, id]))
  const catalog: CatalogItem[] = []
  for (const item of Object.values(table.items)) {
    const training = item.itemType.match(/^VOUCHER_(LEVELMAX|ELITE_II|SKILL_SPECIALLEVELMAX)_([456])$/)
    const kind: CatalogItem['kind'] | null = training ? ({ LEVELMAX: 'level', ELITE_II: 'elite', SKILL_SPECIALLEVELMAX: 'mastery' } as const)[training[1] as 'LEVELMAX']
      : item.itemType === 'VOUCHER_PICK' ? 'selector' : ['MATERIAL_ISSUE_VOUCHER', 'OPTIONAL_VOUCHER_PICK'].includes(item.itemType) ? 'materials' : null
    if (!kind) continue
    const page = Object.entries(pages).find(([_title, text]) => new RegExp(`\\|itemId\\s*=\\s*${item.itemId}(?:\\s|\\n|$)`).test(text))
      ?? (/『[^』]+』/.test(item.description) ? Object.entries(pages).find(([_title, text]) => text.includes(item.description)) : undefined)
    const text = page ? resolvePage(page[0], pages) : ''
    const options: CatalogItem['options'] = []
    let operatorIds: string[] = []
    if (kind === 'selector') {
      const tables = (text.match(/\{\|[\s\S]*?\|\}/g) ?? []).filter((table) => /\{\{干员头像\|/.test(table))
      const range = tables.length > 1 ? tables.filter((table) => {
        const heading = table.split('{{干员头像|')[0]
        return item.itemId.startsWith('voucher_class_') ? /中坚寻访范围/.test(heading) : /标准寻访范围/.test(heading)
      }).join('\n') : text
      const names = [...range.matchAll(/\{\{(?:干员头像|头像)\|([^|}]+)(?:\||\}\})/g)].map((match) => match[1].trim())
      // A selector's description sometimes provides its entire explicit pool.
      if (!names.length && /可从.+选择其一/.test(item.description)) names.push(...(item.description.match(/可从([^，。]+)[，。]/)?.[1]?.split('、') ?? []))
      if (!names.length && /选择其一/.test(item.description)) names.push(...[...item.description.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]))
      operatorIds = [...new Set(names.flatMap((name) => byName.has(name) ? [byName.get(name)!] : []))]
    } else if (kind === 'materials') {
      if (item.itemType === 'MATERIAL_ISSUE_VOUCHER') {
        const tier = /稀有材料/.test(item.name) ? 'TIER_5' : /特级材料/.test(item.name) ? 'TIER_4' : /高级材料/.test(item.name) ? 'TIER_3' : null
        if (tier) for (const material of Object.values(table.items)) if (material.itemType === 'MATERIAL' && /^3[01]\d{3}$/.test(material.itemId) && material.rarity === tier) options.push({ key: material.itemId, name: material.name, items: { [material.itemId]: 1 } })
      } else {
        const rows = [...text.matchAll(/\{\{道具图标\|([^|}]+)\|(\d+)\|/g)]
        const materialId = (name: string) => Object.values(table.items).find((value) => value.name === name)?.itemId
        if (/职业的芯片组合/.test(text)) {
          const bundles = Object.values(table.itemPackInfos).filter((pack) => pack.content.length === 2 && pack.content.every((row) => /^32[1-8][12]$/.test(row.id)))
          for (const bundle of bundles) options.push({ key: bundle.content[0].id, name: table.items[bundle.content[0].id]?.name ?? bundle.content[0].id, items: Object.fromEntries(bundle.content.map((row) => [row.id, row.count])) })
        } else for (const row of rows) { const id = materialId(row[1]); if (id) options.push({ key: id, name: row[1], items: { [id]: Number(row[2]) } }) }
        if (!options.length && /任意芯片(?:组)?一块/.test(item.usage)) for (const material of Object.values(table.items)) if (new RegExp(`^32[1-8]${/芯片组/.test(item.usage) ? '2' : '1'}$`).test(material.itemId)) options.push({ key: material.itemId, name: material.name, items: { [material.itemId]: 1 } })
      }
    }
    catalog.push({ id: item.itemId, name: item.name, iconId: item.iconId, kind, rarity: training ? Number(training[2]) : null,
      scope: item.itemType === 'VOUCHER_PICK' ? item.description : item.usage,
      sourceUrl: `https://prts.wiki/w/${encodeURIComponent(page?.[0] ?? item.name)}`, operators: operatorIds, options })
  }
  return catalog
}

export async function getSpecialItemCatalog(operators: PrtsSnapshot['operators']): Promise<Catalog> {
  if (cache && Date.now() < nextAttempt) return cache
  pending ??= refreshCatalog(operators).finally(() => { pending = null })
  return pending
}

async function refreshCatalog(operators: PrtsSnapshot['operators']): Promise<Catalog> {
  const path = join(dirname(prtsSnapshotPath()), 'special-item-catalog.json')
  if (!cache) {
    try { cache = { ...savedSchema.parse(JSON.parse(await readFile(path, 'utf8'))), status: 'stale' } } catch { /* Refresh absent or invalid caches. */ }
  }
  if (cache?.updatedAt && Date.now() - Date.parse(cache.updatedAt) < 86400000) { nextAttempt = Date.parse(cache.updatedAt) + 86400000; cache.status = 'fresh'; return cache }
  try {
    const [itemsResponse, specialResponse, skillsResponse] = await Promise.all(['item_table', 'special_operator_table', 'skill_table'].map((table) => fetchCultivationJson(`https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@master/zh_CN/gamedata/excel/${table}.json`, table === 'skill_table' ? 30_000_000 : 5_000_000)))
    const table = gameSchema.parse(itemsResponse)
    const excludedOperators = Object.keys(z.object({ operatorBasicData: z.record(z.string(), z.object({ soCharId: z.string() })) }).parse(specialResponse).operatorBasicData)
    const skills = z.record(z.string(), z.object({ iconId: z.string().nullable() })).parse(skillsResponse)
    const skillIcons = Object.fromEntries(Object.entries(skills).map(([id, skill]) => [id, skill.iconId || id]))
    const api = (args: Record<string, string>) => `https://prts.wiki/api.php?${new URLSearchParams({ format: 'json', ...args })}`
    const index = asRecord(asRecord(await fetchCultivationJson(api({ action: 'ask', query: '[[itemId::~voucher*]] OR [[分类:提货券]]|?itemId|limit=500' }))).query)
    if (Number(asRecord(index.meta).count) >= 500) throw new Error('PRTS 道具索引需要分页')
    const entries = Object.entries(asRecord(index.results)).filter(([_title, value]) => {
      const id = asRecord(asRecord(value).printouts).ItemId
      return Array.isArray(id) && id.some((key) => /^voucher_(?:class_pick|item_pick|recruitR.+pick)/.test(String(key)) || (table.items[String(key)] && /VOUCHER_PICK|VOUCHER_(LEVELMAX|ELITE_II|SKILL)|MATERIAL_ISSUE/.test(table.items[String(key)].itemType)))
    })
    if (!entries.length) throw new Error('PRTS 道具索引为空')
    const pages: Record<string, string> = {}
    for (let offset = 0; offset < entries.length; offset += 40) {
      const batch = await fetchCultivationJson(api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: entries.slice(offset, offset + 40).map(([title]) => title).join('|') }))
      for (const page of Object.values(asRecord(asRecord(asRecord(batch).query).pages))) {
        const row = asRecord(page)
        const text = asRecord(asRecord(asRows(row.revisions)[0]).slots).main
        const content = asRecord(text)['*']
        if (typeof row.title === 'string' && typeof content === 'string') pages[row.title] = content
      }
    }
    const items = parseSpecialItemCatalog(table, pages, operators)
    if (!items.some((item) => item.kind === 'selector' && item.operators.length)) throw new Error('PRTS 自选凭证名单缺失')
    cache = { parserVersion: 4, status: 'fresh', updatedAt: new Date().toISOString(), items, excludedOperators, skillIcons, itemNames: Object.fromEntries(Object.values(table.items).map((item) => [item.itemId, item.name])), itemIcons: Object.fromEntries(Object.values(table.items).map((item) => [item.itemId, item.iconId])) }
    nextAttempt = Date.now() + 86400000
    await saveCultivationReference(path, cache).catch(() => undefined)
  } catch {
    cache = cache ? { ...cache, status: 'stale' } : { parserVersion: 4, status: 'unavailable', updatedAt: '', items: [], excludedOperators: [], skillIcons: {}, itemNames: {}, itemIcons: {} }
    nextAttempt = Date.now() + 300000
  }
  return cache
}

export type SpecialItemCatalog = Awaited<ReturnType<typeof getSpecialItemCatalog>>

export function buildSpecialItemRecommendations(snapshot: PrtsSnapshot, player: ReturnType<typeof readCultivationPlayer>, catalog: SpecialItemCatalog, community: CultivationData['community'], demands: Map<string, { total: number; skills: Record<number, number>; elite: number }>): CultivationSpecialItem[] {
  return catalog.items.filter((item) => (player.inventory[item.id] ?? 0) > 0).map((item) => {
    const recommendations: CultivationSpecialItem['recommendations'] = []
    const expiresAt = player.expiries[item.id] ?? null
    const available = !expiresAt || Date.parse(expiresAt) > Date.now()
    const ids = item.kind === 'selector' ? item.operators : [...player.characters.keys()]
    if (item.kind === 'materials') for (const option of item.options) recommendations.push({ ...option, demand: 0, communityRate: null, warnings: [] })
    else for (const id of ids) {
      const operator = snapshot.operators[id]
      const current = player.characters.get(id)
      if (!operator || (item.rarity && operator.rarity !== item.rarity)) continue
      const statistics = community?.operators[id]
      const demand = demands.get(id)
      if (item.kind === 'selector') {
        recommendations.push({ key: id, name: operator.name, operatorId: id, owned: Boolean(current), demand: demand?.total ?? 0, communityRate: statistics?.elite[2] ?? null, items: {}, warnings: [] })
        continue
      }
      if (!current || !available || catalog.excludedOperators.includes(id)) continue
      if (item.kind === 'elite' && current.elite >= 2) continue
      if (item.kind === 'level' && (current.elite !== 2 || current.level >= (snapshot.costs.levels.maxLevel[operator.rarity - 1]?.[2] ?? 0))) continue
      if (item.kind === 'mastery' && (current.elite !== 2 || current.skillLevel !== 7)) continue
      const skills = item.kind === 'mastery' ? operator.skills : [operator.skills[0]]
      skills.forEach((skillId, index) => {
        if (item.kind === 'mastery' && (current.masteries[skillId] === undefined || current.masteries[skillId] >= 3)) return
        const target = { elite: 2, level: item.kind === 'level' ? snapshot.costs.levels.maxLevel[operator.rarity - 1][2] : item.kind === 'mastery' ? current.level : 1,
          skill: index + 1, skillLevel: item.kind === 'mastery' ? 10 : 1, moduleId: null, moduleLevel: 0, potential: current.potential }
        const cost = cultivationCosts(snapshot, id, current, target, skillId)
        if (cost.warnings.length) return
        recommendations.push({ key: `${id}:${index + 1}`, name: operator.name, operatorId: id, skill: item.kind === 'mastery' ? index + 1 : undefined,
          demand: (item.kind === 'mastery' ? demand?.skills[index + 1] : item.kind === 'elite' ? demand?.elite : demand?.total) ?? 0,
          communityRate: item.kind === 'mastery' ? statistics?.skills[index]?.[3] ?? null : statistics?.elite[2] ?? null,
          items: cost.items, warnings: cost.warnings })
      })
    }
    return { id: item.id, name: item.name, iconId: item.iconId, kind: item.kind, count: player.inventory[item.id], scope: item.scope, sourceUrl: item.sourceUrl, expiresAt, available,
      recommendations }
  })
}
