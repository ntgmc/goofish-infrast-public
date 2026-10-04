import type { CultivationCurrent, CultivationPotion } from '../../src/lib/cultivation-contract'
import { EXP_ITEM_VALUES } from '../handlers/material-value'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'

function quantity(value: unknown) {
  const count = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 1_000_000_000) throw new Error('森空岛库存数量无效')
  return count
}

function expiry(value: unknown) {
  if (value === undefined || value === null || value === 0 || value === -1) return null
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw new Error('森空岛理智药有效期无效')
  return date.toISOString()
}

export function readCultivationPlayer(playerInfo: unknown, cultivatePlayer: unknown, snapshot: PrtsSnapshot) {
  const game = asRecord(asRecord(playerInfo).data ?? playerInfo)
  const player = asRecord(asRecord(cultivatePlayer).data ?? cultivatePlayer)
  if (!Array.isArray(player.items) || !Array.isArray(game.chars)) throw new Error('森空岛练度或库存格式异常')
  const inventory: Record<string, number> = {}
  const expiries: Record<string, string> = {}
  const potions: CultivationPotion[] = []
  for (const item of asRows(player.items)) {
    const id = String(item.id ?? item.itemId ?? '')
    if (!id) throw new Error('森空岛库存缺少物品编号')
    const count = quantity(item.count ?? item.quantity)
    if (/^ap_supply_/.test(id) || snapshot.potionValues[id] !== undefined) {
      potions.push({ key: `${id}:${potions.length}`, name: snapshot.itemNames[id] ?? id, count, sanity: snapshot.potionValues[id] ?? null, expiresAt: expiry(item.expireTs ?? item.expireTime ?? item.expiresAt) })
    } else {
      inventory[id] = (inventory[id] ?? 0) + count
      const expiresAt = expiry(item.expireTs ?? item.expireTime ?? item.expiresAt)
      if (expiresAt && (!expiries[id] || expiresAt < expiries[id])) expiries[id] = expiresAt
    }
  }
  inventory.exp = Object.entries(EXP_ITEM_VALUES).reduce((sum, [id, value]) => sum + (inventory[id] ?? 0) * value, 0)
  const characters = new Map<string, CultivationCurrent>()
  const cultivateChars = new Map(asRows(player.characters).map((row) => [String(row.id ?? row.characterId ?? row.charId), row]))
  for (const raw of asRows(game.chars)) {
    const id = String(raw.charId ?? raw.id ?? '')
    if (!snapshot.operators[id]) continue
    const cal = cultivateChars.get(id)
    const skillLevel = cal?.mainSkillLvl ?? cal?.mainSkillLevel ?? raw.mainSkillLvl ?? raw.mainSkillLevel
    const masteries: Record<string, number> = {}
    for (const skill of [...asRows(raw.skills), ...asRows(cal?.skills)]) {
      const skillId = String(skill.skillId ?? skill.id ?? '')
      const level = skill.specializeLevel ?? skill.specializeLvl ?? skill.level
      if (skillId && typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 3) masteries[skillId] = level
    }
    const equips = cal?.equips ?? cal?.equip ?? raw.equips ?? raw.equip
    const modules: Record<string, number> = {}
    if (Array.isArray(equips)) for (const equip of asRows(equips)) {
      const equipId = String(equip.equipId ?? equip.id ?? '')
      if (equipId) modules[equipId] = quantity(equip.level ?? 0)
    }
    else for (const [equipId, value] of Object.entries(asRecord(equips))) modules[equipId] = quantity(asRecord(value).level ?? value)
    characters.set(id, {
      elite: quantity(cal?.evolvePhase ?? raw.evolvePhase), level: quantity(cal?.level ?? raw.level),
      skillLevel: typeof skillLevel === 'number' && Number.isInteger(skillLevel) && skillLevel >= 1 && skillLevel <= 7 ? skillLevel : null,
      masteries, modules, modulesKnown: equips !== undefined && equips !== null, potential: quantity(cal?.potentialRank ?? raw.potentialRank ?? 0) + 1,
    })
  }
  // Some Skland inventories return consumables separately from cultivation materials.
  const inventoryPotionIds = new Set(potions.map((potion) => potion.key.split(':')[0]))
  for (const item of asRows(game.apSupply ?? player.apSupply)) {
    const id = String(item.itemId ?? item.id ?? '')
    const expiresAt = expiry(item.expireTs ?? item.expireTime)
    if (!id || inventoryPotionIds.has(id)) continue
    potions.push({ key: `${id}:${potions.length}`, name: snapshot.itemNames[id] ?? id, count: quantity(item.count), sanity: snapshot.potionValues[id] ?? null, expiresAt })
  }
  return { inventory, potions, characters, expiries }
}
