import catalog from '../data/building-skills.json'
import partners from '../data/building-rating-warehouse-partners.json'
import { copy } from '../copy'
import type { RatingMember, RatingVariant } from './building-skill-ratings'

const characters: Record<string, typeof catalog.operators.char_190_clour> = catalog.operators
const rhineSkills = new Set(['manu_prod_spd[001]', 'manu_prod_spd[011]', 'manu_prod_spd[021]'])
const member = (id: string, elite: number, room = 'manufacture', level = 1): RatingMember => ({ id, elite, level, room, station: 'main' })

export function warehouseBuildingVariants(id: string): RatingVariant[] {
  const bubble = id === 'bubble'
  const core = member(bubble ? 'char_381_bubble' : 'char_190_clour', 1)
  const variants: RatingVariant[] = []
  for (const recipe of ['gold', 'exp'] as const) for (let first = 0; first < partners.length; first++) {
    for (let second = first; second < partners.length; second++) {
      const selected = second === first ? [partners[first]] : [partners[first], partners[second]]
      if (selected.length === 2 && selected[0].id === selected[1].id) continue
      if (selected.some((partner) => partner.companion && !selected.some((other) => other.id === partner.companion))) continue
      const members = selected.map((partner) => member(partner.id, partner.elite, 'manufacture', partner.level ?? 1))
      const rhineCount = members.reduce((count, item) => {
        const active = new Map<number, string>()
        for (const skill of characters[item.id].skills) if (skill.elite < item.elite || skill.elite === item.elite && skill.level <= item.level) active.set(skill.slot, skill.id)
        return count + [...active.values()].filter((skill) => rhineSkills.has(skill)).length
      }, 0)
      const effects = selected.map((partner) => ({
        capacity: partner.capacity + (recipe === 'exp' ? partner.expCapacity ?? 0 : 0) + (partner.rhineCapacity ? rhineCount * 5 : 0),
        production: partner.production + (recipe === 'exp' ? partner.expProduction ?? 0 : partner.goldProduction ?? 0)
          + (partner.rhineProduction ? rhineCount * 5 : 0)
          + (partner.christine && recipe === 'exp' && selected.some((other) => other.id === 'char_1042_phatm2') ? 30 : 0),
      }))
      if (effects.some((effect) => effect.capacity === 0 && effect.production === 0)) continue
      if (!effects.some((effect) => effect.capacity > 0)) continue
      const support = selected.flatMap((partner) => partner.support?.map((operatorId) => member(operatorId, operatorId === 'char_459_tachak' ? 2 : 0, 'control')) ?? [])
      const capacity = (bubble ? 10 : 8) + effects.reduce((sum, effect) => sum + effect.capacity, 0)
      const convert = (value: number) => Math.max(0, value) * (bubble ? value > 16 ? 3 : 1 : 2)
      const production = convert(bubble ? 10 : 8) + effects.reduce((sum, effect) => sum + effect.production + convert(effect.capacity), 0)
      const requirements = Object.assign({}, ...selected.filter((partner) => recipe === 'gold' || !partner.goldProduction).map((partner) => partner.requirements))
      const notes = selected.map((partner) => recipe === 'exp' && partner.goldProduction ? '' : partner.conditions ?? '').filter(Boolean)
      variants.push({
        members: [core, ...members, ...support], recipe, production, capacity,
        score: warehouseScore(production / (members.length + 1)) - support.length,
        reason: copy.buildingRatings.warehouseReasons[bubble ? 'bubble' : 'redcloud'],
        conditions: [copy.buildingRatings.warehouseConditions(recipe, members.length + 1), ...notes].join(''),
        provisional: true,
        requirements: { ...requirements, manufactureLevel: members.length + 1 },
      })
    }
  }
  return variants.sort((a, b) => b.score - a.score || b.production! - a.production!)
}

// 同用途按每个工作位的生产贡献分档，再保留跨设施配套的位置成本。
function warehouseScore(perMember: number) {
  return perMember >= 38 ? 95 : perMember >= 33 ? 90 : perMember >= 30 ? 85 : perMember >= 27 ? 80 : perMember >= 24 ? 75 : perMember >= 20 ? 65 : perMember >= 15 ? 55 : perMember >= 10 ? 40 : 25
}
