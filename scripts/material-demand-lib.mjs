import assert from 'node:assert/strict'
import { z } from 'zod'

const costSchema = z.object({ id: z.string(), count: z.number().nonnegative() })
const costs = z.array(costSchema).nullish()
const characterSchema = z.object({
  name: z.string(), rarity: z.enum(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6']),
  isNotObtainable: z.boolean(), phases: z.array(z.object({ evolveCost: costs })),
  allSkillLvlup: z.array(z.object({ lvlUpCost: costs })),
  skills: z.array(z.object({ levelUpCostCond: z.array(z.object({ levelUpCost: costs })) })),
})
const tablesSchema = z.object({
  character_table: z.record(z.string(), characterSchema),
  char_patch_table: z.object({
    patchChars: z.record(z.string(), characterSchema),
    patchDetailInfoList: z.record(z.string(), z.object({ infoParam: z.string() })),
  }),
  item_table: z.object({ items: z.record(z.string(), z.object({ name: z.string(), rarity: z.string(), iconId: z.string() })) }),
  building_data: z.object({ workshopFormulas: z.record(z.string(), z.object({ formulaType: z.string(), itemId: z.string(), count: z.number().positive(), costs: z.array(costSchema) })) }),
  uniequip_table: z.object({ equipDict: z.record(z.string(), z.object({
    charId: z.string(), uniEquipName: z.string(), uniEquipGetTime: z.number(),
    itemCost: z.record(z.string(), z.array(costSchema)).nullish(),
  })) }),
})
const ordinaryMaterial = (id) => /^(?:30|31)\d{3}$/.test(id)

export function parseOperatorReleaseDates(html) {
  const decode = (value) => value.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[key]).trim()
  const releases = new Map()
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1]))
    const match = cells[2]?.match(/^(20\d{2})年(\d+)月(\d+)日/)
    if (!match || !/^[1-6]$/.test(cells[1])) continue
    const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    assert(new Date(`${date}T00:00:00Z`).toISOString().startsWith(date), `Invalid release date: ${date}`)
    const key = `${cells[0]}:${cells[1]}`
    assert(!releases.has(key) || releases.get(key) === date, `Conflicting release dates: ${key}`)
    releases.set(key, date)
  }
  assert(releases.size > 0, 'Missing operator release dates')
  return releases
}

export function buildMaterialDemand(rawTables, releaseHtml, { gameSha, asOf, releaseDatesSha256 }) {
  assert(/^[a-f0-9]{40}$/.test(gameSha), 'Invalid game data SHA')
  assert(/^\d{4}-\d{2}-\d{2}$/.test(asOf) && new Date(`${asOf}T00:00:00Z`).toISOString().startsWith(asOf), 'Invalid snapshot date')
  const tables = tablesSchema.parse(rawTables)
  const releases = parseOperatorReleaseDates(releaseHtml)
  const items = tables.item_table.items
  const materialIds = Object.keys(items).filter(ordinaryMaterial)
  const materials = materialIds.filter((id) => items[id].rarity === 'TIER_3').sort().map((id) => ({ id, name: items[id].name, icon: items[id].iconId }))
  assert(materials.length > 0, 'Missing tier-three materials')
  const indices = new Map(materials.map((item, index) => [item.id, index]))
  const recipes = new Map(Object.values(tables.building_data.workshopFormulas).filter((row) => row.formulaType === 'F_EVOLVE').map((row) => [row.itemId, row]))
  const units = new Map()
  function expand(id, visiting = new Set()) {
    if (units.has(id)) return units.get(id)
    assert(items[id], `Missing ordinary material: ${id}`)
    assert(!visiting.has(id), `Cyclic material recipe: ${id}`)
    const vector = materials.map(() => 0)
    if (indices.has(id)) vector[indices.get(id)] = 1
    else if (['TIER_1', 'TIER_2'].includes(items[id].rarity)) {
      const target = `${id.slice(0, -1)}3`
      assert(indices.has(target), `Missing tier-three family: ${id}`)
      let current = target, ratio = 1
      const seen = new Set()
      while (current !== id) {
        assert(!seen.has(current), `Cyclic lower-tier recipe: ${current}`)
        seen.add(current)
        const recipe = recipes.get(current)
        assert(recipe?.costs.length === 1, `Missing lower-tier recipe: ${current}`)
        ratio *= recipe.costs[0].count / recipe.count
        current = recipe.costs[0].id
      }
      vector[indices.get(target)] = 1 / ratio
    } else {
      const recipe = recipes.get(id)
      assert(recipe, `Missing material recipe: ${id}`)
      for (const cost of recipe.costs) {
        if (!ordinaryMaterial(cost.id)) continue
        const child = expand(cost.id, new Set([...visiting, id]))
        child.forEach((amount, index) => { vector[index] += amount * cost.count / recipe.count })
      }
    }
    assert(vector.every(Number.isFinite) && vector.some((value) => value > 0), `Invalid expansion: ${id}`)
    units.set(id, vector)
    return vector
  }
  for (const id of materialIds) expand(id)
  const makeEvent = (id, name, date, rarity, rows) => {
    const direct = new Map()
    for (const cost of rows) if (ordinaryMaterial(cost.id)) direct.set(cost.id, (direct.get(cost.id) ?? 0) + cost.count)
    const amounts = materials.map(() => 0)
    for (const [item, count] of direct) expand(item).forEach((value, index) => { amounts[index] += value * count })
    return { id, name, date, rarity, amounts }
  }
  const operators = []
  const playable = new Map()
  for (const [id, row] of Object.entries(tables.character_table)) {
    if (!id.startsWith('char_') || row.isNotObtainable) continue
    const rarity = Number(row.rarity.slice(-1))
    const date = releases.get(`${row.name}:${rarity}`)
    assert(date, `Missing operator release date: ${id} ${row.name}`)
    playable.set(id, row)
    if (date > asOf) continue
    const rows = [...row.phases.flatMap((phase) => phase.evolveCost ?? []), ...row.allSkillLvlup.flatMap((rank) => rank.lvlUpCost ?? []),
      ...row.skills.flatMap((skill) => skill.levelUpCostCond.flatMap((rank) => rank.levelUpCost ?? []))]
    operators.push(makeEvent(id, row.name, date, rarity, rows))
  }
  // Alternate Amiya forms share promotion and skill ranks; only new masteries are added.
  for (const [id, row] of Object.entries(tables.char_patch_table.patchChars)) {
    if (row.isNotObtainable) continue
    const role = tables.char_patch_table.patchDetailInfoList[id]?.infoParam
    assert(role, `Missing form name: ${id}`)
    const name = `${row.name}(${role})`, rarity = Number(row.rarity.slice(-1))
    const date = releases.get(`${name}:${rarity}`)
    assert(date, `Missing form release date: ${id}`)
    playable.set(id, row)
    if (date <= asOf) operators.push(makeEvent(id, name, date, rarity, row.skills.flatMap((skill) => skill.levelUpCostCond.flatMap((rank) => rank.levelUpCost ?? []))))
  }
  const modules = []
  for (const [id, row] of Object.entries(tables.uniequip_table.equipDict)) {
    if (!row.itemCost || !Object.keys(row.itemCost).length) continue
    const operator = playable.get(row.charId)
    assert(operator, `Missing module operator: ${id} ${row.charId}`)
    assert(row.uniEquipGetTime > 0, `Missing module release date: ${id}`)
    const date = new Date((row.uniEquipGetTime + 8 * 3600) * 1000).toISOString().slice(0, 10)
    if (date <= asOf) modules.push(makeEvent(id, `${operator.name} · ${row.uniEquipName}`, date, Number(operator.rarity.slice(-1)), Object.values(row.itemCost).flat()))
  }
  const sortEvents = (rows) => rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  assert(operators.length > 0, 'Missing operator costs')
  return { version: 1, asOf, gameSha, releaseDatesSha256, materials, operators: sortEvents(operators), modules: sortEvents(modules) }
}
