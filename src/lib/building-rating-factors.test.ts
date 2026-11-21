import { describe, expect, it } from 'vitest'
import { copy } from '../copy'
import { buildingRatingFactors, type RatingFactorId } from './building-rating-factors'
import { buildingRatingCombos, singleBuildingRatings } from './building-skill-ratings'

const factor = (room: string, ids: string[], id: RatingFactorId) => buildingRatingFactors(room, ids).factors.find((item) => item.id === id)!
const processing = (name: string) => singleBuildingRatings.find((entry) => entry.name === name && entry.room === 'processing')!

describe('descriptive building rating factors', () => {
  it('uses ordinary five-level references, reviewed exceptional tiers, and explicit unknowns across all stages', () => {
    const snapshots = singleBuildingRatings.map((entry) => entry.stages.map((stage) => stage.assessment.score))
    for (const entry of singleBuildingRatings) for (const stage of entry.stages) {
      const profile = buildingRatingFactors(entry.room, stage.skills)
      expect(profile.factors, entry.id).toHaveLength(5)
      expect(new Set(profile.factors.map((item) => item.id)).size).toBe(5)
      for (const item of profile.factors) {
        expect(copy.buildingRatings.factors.basis[item.basis], `${entry.id}/${item.basis}`).toBeTruthy()
        for (const scene of item.scenes ?? []) expect(copy.buildingRatings.factors.basis[scene]).toBeTruthy()
        expect(item.score === null || Number.isInteger(item.score) && item.score >= 1 && item.score <= 9, entry.id).toBe(true)
        if (item.score !== null && item.score > 5) {
          expect(entry.room).toBe('trading')
          expect(item.basis).toMatch(/^orderValue/)
        }
        if (item.raw !== undefined) expect(Number.isFinite(item.raw), entry.id).toBe(true)
      }
    }
    expect(singleBuildingRatings.map((entry) => entry.stages.map((stage) => stage.assessment.score))).toEqual(snapshots)
  })

  it('allows order-value effects beyond the ordinary fifth level without claiming a speed percentage', () => {
    const proviso = singleBuildingRatings.find((entry) => entry.name === '但书' && entry.room === 'trading')!
    const early = factor('trading', proviso.stages[0].skills, 'efficiency')
    const elite = factor('trading', proviso.stage.skills, 'efficiency')
    const closure = singleBuildingRatings.find((entry) => entry.name === '可露希尔' && entry.room === 'trading')!
    const special = factor('trading', closure.stage.skills, 'efficiency')
    expect(early.score).toBe(6)
    expect(elite.score).toBe(8)
    expect(special.score).toBe(9)
    expect(elite.raw).toBeUndefined()
    expect(special.raw).toBeUndefined()
    expect(special.basis).toBe('orderValueClosure')
  })

  it.each(['空弦', '吉星'])('evaluates %s at the routine achievable total instead of its per-unit coefficient', (name) => {
    const entry = singleBuildingRatings.find((item) => item.name === name && item.room === 'trading')!
    const early = factor('trading', entry.stages[0].skills, 'efficiency')
    const elite = factor('trading', entry.stage.skills, 'efficiency')
    expect(early.raw).toBe(20)
    expect(elite.raw).toBe(40)
    expect(early.score).toBe(3)
    expect(elite.score).toBe(5)
    expect(elite.scenes).toEqual([name === '空弦' ? 'fourDorms' : 'twoCoworkers'])
  })

  it('combines routine multipliers with the other active skill rather than dropping or double counting it', () => {
    expect(factor('power', ['power_rec_spd[005]', 'power_rec_spd&dorm&lv[000]'], 'efficiency').raw).toBe(20)
    expect(factor('manufacture', ['manu_formula_spd[102]', 'manu_prod_spd&trade[1000]'], 'efficiency').raw).toBe(36)
    expect(factor('manufacture', ['manu_constrLv[000]', 'manu_prod_spd_bd[110]'], 'efficiency').raw).toBe(40)
    expect(factor('manufacture', ['manu_prod_spd&trade[000]'], 'efficiency').raw).toBe(40)
    expect(factor('manufacture', ['manu_prod_spd_addition[030]'], 'efficiency').raw).toBe(23.125)
    expect(factor('manufacture', ['manu_prod_spd_addition[040]'], 'efficiency').raw).toBe(21.25)
  })

  it('includes applicable support from other facilities without substituting an unrelated facility bonus', () => {
    const result = factor('trading', ['trade_ord_spd&limit[022]', 'trade_ord_spd&limit[021]', 'trade_ord_spd&limit[020]', 'control_tra_limit&spd3[000]'], 'efficiency')
    expect(result.raw).toBe(60)
    expect(result.scenes).toContain('threeKjerag')
    expect(factor('trading', ['trade_ord_spd&limit[022]', 'control_tra_spd[000]'], 'efficiency').raw).toBe(27)
    expect(factor('meeting', ['hire_spd_dorm&lv[010]'], 'efficiency').raw).toBe(0)
  })

  it('separates high byproduct bonuses, recipe coverage, and mood costs', () => {
    const nian = buildingRatingFactors('processing', processing('年').stage.skills)
    const horn = buildingRatingFactors('processing', processing('号角').stage.skills)
    const get = (profile: typeof nian, id: RatingFactorId) => profile.factors.find((item) => item.id === id)!
    expect(get(nian, 'efficiency').raw).toBe(100)
    expect(get(horn, 'efficiency').raw).toBe(100)
    expect(get(nian, 'efficiency').score).toBe(5)
    expect(get(horn, 'efficiency').score).toBe(5)
    expect(get(nian, 'coverage').score).toBeGreaterThan(get(horn, 'coverage').score!)
    expect(get(nian, 'mood').raw).toBe(2)
    expect(get(nian, 'mood').high).toBe(2)
    expect(get(horn, 'mood').raw).toBe(-1)
    expect(get(horn, 'mood').high).toBe(0)
    expect(get(horn, 'mood').score).toBeGreaterThan(get(nian, 'mood').score!)
    expect(processing('年').stage.assessment.score).toBe(95)
    expect(processing('号角').stage.assessment.score).toBe(80)
  })

  it('uses the original recipe cost for conditional reductions and constant-cost skills', () => {
    const mudrock = factor('processing', processing('泥岩').stage.skills, 'mood')
    expect(mudrock.raw).toBe(-6)
    expect(mudrock.high).toBe(0)
    const luoxiaohei = factor('processing', processing('罗小黑').stage.skills, 'mood')
    expect(luoxiaohei.raw).toBe(-6)
    expect(luoxiaohei.high).toBe(0)
  })

  it('does not replace variable or hidden effects with zero efficiency', () => {
    expect(factor('processing', processing('九色鹿').stage.skills, 'efficiency').score).toBeNull()
    expect(factor('processing', processing('芳汀').stage.skills, 'efficiency').score).toBeNull()
    expect(factor('control', ['control_mp_cost[000]'], 'efficiency').score).toBeNull()
    expect(factor('processing', processing('芳汀').stage.skills, 'facility').raw).toBeGreaterThan(0)
  })

  it('keeps hourly self-consumption separate from solitary work-position costs', () => {
    const forcer = singleBuildingRatings.find((entry) => entry.name === '见行者' && entry.room === 'meeting')!
    const ho = singleBuildingRatings.find((entry) => entry.name === '霍尔海雅' && entry.room === 'meeting')!
    expect(factor('meeting', forcer.stage.skills, 'mood').raw).toBe(2)
    expect(factor('meeting', forcer.stage.skills, 'slots').score).toBe(5)
    expect(factor('meeting', ho.stage.skills, 'slots').score).toBe(1)
    expect(factor('meeting', ho.stage.skills, 'slots').raw).toBe(1)
    expect(factor('meeting', forcer.stage.skills, 'efficiency').raw).toBe(35)
  })

  it('distinguishes profession coverage and conditional training boosts', () => {
    const generic = buildingRatingFactors('training', ['train_spd[000]'])
    const specialized = buildingRatingFactors('training', ['train_spd&profession2[110]'])
    expect(generic.factors.find((item) => item.id === 'coverage')!.raw).toBe(8)
    expect(specialized.factors.find((item) => item.id === 'coverage')!.raw).toBe(1)
    expect(specialized.factors.find((item) => item.id === 'efficiency')!.raw).toBe(75)
    expect(specialized.factors.find((item) => item.id === 'efficiency')!.conditional).toBe(true)
    expect(specialized.factors.find((item) => item.id === 'flexibility')!.score).toBeLessThan(generic.factors.find((item) => item.id === 'flexibility')!.score!)
  })

  it('uses actual production, worker count, and dependencies when a warehouse variant changes', () => {
    const combo = buildingRatingCombos.find((item) => item.id === 'redcloud')!
    const before = combo.variants.find((item) => item.production === 76)!
    const after = combo.variants.find((item) => item.production === 96)!
    for (const variant of [before, after]) {
      const original = structuredClone(variant)
      const profile = buildingRatingFactors('manufacture', [], variant)
      const efficiency = profile.factors.find((item) => item.id === 'efficiency')!
      expect(efficiency.raw).toBe(variant.production! / variant.members.filter((member) => member.room === 'manufacture').length)
      expect(profile.factors.find((item) => item.id === 'team')!.raw).toBe(variant.members.length - 1)
      expect(variant).toEqual(original)
    }
    const winter = buildingRatingCombos.find((item) => item.id === 'winter')!.variants[0]
    expect(buildingRatingFactors('manufacture', [], winter).factors.find((item) => item.id === 'facility')!.raw).toBeGreaterThan(0)
  })
})
