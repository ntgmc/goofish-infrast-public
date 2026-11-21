import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import catalog from '../data/building-skills.json'
import published from '../data/building-skill-ratings.json'
import warehousePartners from '../data/building-rating-warehouse-partners.json'
import { canonicalJson } from './crypto'
import { CONFIG_PRESETS } from './config'
import { buildingRatingCombos, buildingRatingRoster, buildingRatingTrainingCost, ratingMemberStatus, ratingVariantStatus, singleBuildingRatings, type RatingMember } from './building-skill-ratings'
import type { LicenseOperator } from './types'

const characters: Record<string, typeof catalog.operators.char_285_medic2> = catalog.operators
const skills: Record<string, { room: string }> = catalog.skills
const owned = (member: RatingMember, extra: Partial<LicenseOperator> = {}): LicenseOperator => ({ id: member.id, name: characters[member.id].name, own: true, elite: member.elite, level: member.level, rarity: 5, ...extra })
const shamare = buildingRatingCombos.find((combo) => combo.id === 'shamare')!
const config = { ...CONFIG_PRESETS['243'], trading_station_levels: [3, 3], manufacturing_station_levels: [3, 3, 3, 3] }

describe('published building skill ratings', () => {
  it('requires reassessment when effects or unlocks change and covers every source definition exactly once', () => {
    const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
    expect(Object.fromEntries(Object.entries(catalog.skills).map(([id, skill]) => [id, hash(skill)]))).toEqual(published.reviewedSkills)
    expect(Object.fromEntries(Object.entries(catalog.operators).map(([id, operator]) => [id, hash(operator)]))).toEqual(published.reviewedOperators)
    const ids = published.reviews.flatMap((review) => review.skills)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(Object.keys(catalog.skills).sort())
  })

  it('represents every dependent effect at an unlock phase where it actually takes effect', () => {
    const represented = new Set<string>()
    for (const combo of buildingRatingCombos) for (const variant of combo.variants) for (const member of variant.members) {
      const active = new Map<number, string>()
      for (const skill of characters[member.id].skills) {
        if (skill.elite < member.elite || skill.elite === member.elite && skill.level <= member.level) active.set(skill.slot, skill.id)
      }
      for (const id of active.values()) if (skills[id].room === member.room) represented.add(id)
    }
    expect(published.reviews.filter((review) => review.score === null).flatMap((review) => review.skills).filter((id) => !represented.has(id))).toEqual([])
  })

  it('assigns every operator facility use to an independent entry or an actual combination', () => {
    const covered = new Set(singleBuildingRatings.map((entry) => `${entry.operatorId}:${entry.room}`))
    for (const combo of buildingRatingCombos) for (const variant of combo.variants) for (const member of variant.members) covered.add(`${member.id}:${member.room}`)
    const missing: string[] = []
    for (const [id, operator] of Object.entries(catalog.operators)) for (const skill of operator.skills) {
      const room = skills[skill.id].room
      if (!covered.has(`${id}:${room}`)) missing.push(`${operator.name}/${room}`)
    }
    expect(missing).toEqual([])
  })

  it('publishes legal member references, progression requirements, station capacities, and scored variants', () => {
    const capacities: Record<string, number> = { control: 5, dormitory: 5, trading: 3, manufacture: 3, power: 1, hire: 1, meeting: 2, training: 1, processing: 1 }
    for (const combo of buildingRatingCombos) {
      expect(combo.variants.length, combo.id).toBeGreaterThan(0)
      for (const variant of combo.variants) {
        expect(Number.isInteger(variant.score) && variant.score >= 0 && variant.score <= 100, combo.id).toBe(true)
        expect(new Set(variant.members.map((member) => member.id)).size, combo.id).toBe(variant.members.length)
        const stations = new Map<string, number>()
        for (const member of variant.members) {
          expect(characters[member.id], `${combo.id}/${member.id}`).toBeDefined()
          const key = `${member.room}:${member.station}`
          stations.set(key, (stations.get(key) ?? 0) + 1)
          expect(member.elite).toBeGreaterThanOrEqual(0)
          expect(member.level).toBeGreaterThanOrEqual(1)
          expect(() => buildingRatingTrainingCost(member, null), `${combo.id}/${member.id}`).not.toThrow()
          if (capacities[member.room]) expect(stations.get(key), `${combo.id}/${key}`).toBeLessThanOrEqual(capacities[member.room])
        }
      }
    }
  })

  it('keeps unrelated teams separate while retaining unlock phases of the same pairing', () => {
    expect(new Set(buildingRatingCombos.map((combo) => combo.id)).size).toBe(buildingRatingCombos.length)
    for (const combo of buildingRatingCombos) {
      const core = combo.variants[0].members.filter((member) => combo.variants.every((variant) => variant.members.some((candidate) => candidate.id === member.id)))
      expect(core.length, combo.id).toBeGreaterThan(0)
    }
    const pair = buildingRatingCombos.find((combo) => combo.title === '凛视与提丰')!
    expect(pair.variants.map((variant) => variant.score)).toEqual([78, 68])
  })

  it('keeps automation away from warehouse conversion and includes both manufacturing partners', () => {
    const converters = ['char_190_clour', 'char_381_bubble']
    const automation = new Set(['manu_prod_spd&manu[000]', 'manu_prod_spd&manu[100]', 'manu_prod_spd&power[000]', 'manu_prod_spd&power[010]', 'manu_prod_spd&power[020]'])
    for (const combo of buildingRatingCombos) for (const variant of combo.variants) {
      const automated = variant.members.filter((member) => member.room === 'manufacture').some((member) => {
        const active = new Map<number, string>()
        for (const skill of characters[member.id].skills) if (skill.elite <= member.elite) active.set(skill.slot, skill.id)
        return [...active.values()].some((id) => automation.has(id))
      })
      if (automated) expect(variant.members.some((member) => converters.includes(member.id)), combo.id).toBe(false)
    }
    for (const id of ['char_416_zumama', 'char_4208_wintim']) {
      expect(buildingRatingCombos.some((combo) => combo.variants.some((variant) =>
        ['char_400_weedy', 'char_385_finlpp', id].every((operatorId) => variant.members.some((member) => member.id === operatorId && member.room === 'manufacture'))))).toBe(true)
    }
  })

  it('keeps the four required tailor variants together and preserves Peper in control as an independent use', () => {
    expect(shamare.variants.slice(0, 4).map((variant) => variant.members.map((member) => characters[member.id].name))).toEqual([
      ['巫恋', '龙舌兰', '柏喙'], ['巫恋', '龙舌兰', '卡夫卡'], ['巫恋', '龙舌兰', '折光'], ['巫恋', '龙舌兰', '明椒'],
    ])
    expect(singleBuildingRatings.some((entry) => entry.name === '明椒' && entry.room === 'control')).toBe(true)
    expect(singleBuildingRatings.some((entry) => entry.name === '巫恋' && entry.room === 'trading')).toBe(false)
  })
})

describe('warehouse partner combinations', () => {
  const variant = (comboId: string, recipe: 'gold' | 'exp', members: [string, number][]) => buildingRatingCombos.find((combo) => combo.id === comboId)!.variants.find((item) => item.recipe === recipe && item.members.filter((member) => member.room === 'manufacture').length === members.length + 1 && members.every(([id, elite]) => item.members.some((member) => member.id === id && member.elite === elite)))!

  it.each([
    ['redcloud', 'gold', [['char_500_noirc', 0], ['char_150_snakek', 0]], 76, 28],
    ['redcloud', 'exp', [['char_336_folivo', 2], ['char_452_bstalk', 1]], 92.25, 28],
    ['redcloud', 'gold', [['char_336_folivo', 2], ['char_452_bstalk', 1]], 68.25, 16],
    ['redcloud', 'gold', [['char_4171_wulfen', 2]], 52, 16],
    ['redcloud', 'gold', [['char_1047_halo2', 2], ['char_128_plosis', 2]], 86, 18],
    ['redcloud', 'gold', [['char_1047_halo2', 2], ['char_4048_doroth', 2]], 96, 18],
    ['redcloud', 'exp', [['char_4198_christ', 2], ['char_1042_phatm2', 2]], 101, 18],
    ['bubble', 'gold', [['char_163_hpsts', 2], ['char_369_bena', 0]], 93, 46],
    ['bubble', 'gold', [['char_163_hpsts', 0], ['char_369_bena', 0]], 52, 43],
    ['bubble', 'gold', [['char_378_asbest', 2]], 39, 14],
  ] as [string, 'gold' | 'exp', [string, number][], number, number][])('evaluates %s %s with %j using net capacity, per-member thresholds and active recipe', (comboId, recipe, members, production, capacity) => {
    expect(variant(comboId, recipe, members)).toMatchObject({ production, capacity, requirements: { manufactureLevel: members.length + 1 } })
  })

  it('includes every compatible warehouse provider without repeating a member or losing their minimum unlock', () => {
    const redcloud = buildingRatingCombos.find((combo) => combo.id === 'redcloud')!
    const represented = new Set(redcloud.variants.flatMap((item) => item.members.map((member) => member.id)))
    for (const partner of warehousePartners) expect(represented.has(partner.id), partner.id).toBe(true)
    for (const [id, operator] of Object.entries(catalog.operators)) {
      if (['char_381_bubble', 'char_4208_wintim'].includes(id)) continue
      if (operator.skills.some((skill) => /仓库(?:容量)?(?:上限)?\+/.test(catalog.skills[skill.id as keyof typeof catalog.skills].description))) expect(represented.has(id), operator.name).toBe(true)
    }
  })

  it('requires real external support and keeps live mood and dormitory conditions unknown', () => {
    for (const members of [[['char_4126_fuze', 2]], [['char_4062_totter', 1]], [['char_4138_narant', 2]]] as [string, number][][]) {
      const item = variant('redcloud', 'gold', members)
      expect(item).toBeDefined()
      const match = ratingVariantStatus(item, buildingRatingRoster(item.members.map((member) => owned(member))), config)
      if (members[0][0] === 'char_4126_fuze') expect(item.members.filter((member) => member.room === 'control')).toHaveLength(5)
      else expect(match.state).toBe('unknown')
    }
  })
})

describe('rating profile matching', () => {
  it('distinguishes an unavailable roster, unowned members, missing levels, and a known unlocked phase', () => {
    const robot: RatingMember = { id: 'char_285_medic2', room: 'dormitory', elite: 0, level: 30, station: 'main' }
    expect(ratingMemberStatus(robot, null)).toBe('unknown')
    expect(ratingMemberStatus(robot, new Map())).toBe('missing')
    expect(ratingMemberStatus(robot, buildingRatingRoster([owned(robot, { level: undefined })]))).toBe('unknown')
    expect(ratingMemberStatus(robot, buildingRatingRoster([owned(robot, { level: 29 })]))).toBe('locked')
    expect(ratingMemberStatus(robot, buildingRatingRoster([owned(robot)]))).toBe('ready')
  })

  it('accepts any complete variant without treating ownership as sufficient for use', () => {
    const first = shamare.variants[0]
    const roster = buildingRatingRoster(first.members.map((member) => owned(member)))
    expect(shamare.variants.some((variant) => ratingVariantStatus(variant, roster, config).membersOwned)).toBe(true)
    expect(ratingVariantStatus(first, roster, config).state).toBe('ready')
    expect(ratingVariantStatus(shamare.variants[1], roster, config).state).toBe('missing')
    const secondTeam = buildingRatingCombos.find((combo) => combo.id === 'penguin')!.variants[0].members.map((member) => ({ ...member, station: 'second' }))
    const twoStations = { ...first, members: [...first.members, ...secondTeam] }
    const twoRosters = buildingRatingRoster(twoStations.members.map((member) => owned(member)))
    expect(ratingVariantStatus(twoStations, twoRosters, { ...config, trading_station_levels: [3, 2] }).state).toBe('blocked')
    expect(ratingVariantStatus(twoStations, twoRosters, config).state).toBe('ready')
    const locked = buildingRatingRoster(first.members.map((member, index) => owned(member, index === 0 ? { elite: 0 } : {})))
    expect(ratingVariantStatus(first, locked, config)).toMatchObject({ membersOwned: true, state: 'locked' })
    expect(ratingVariantStatus(first, roster, { ...config, trading_station_levels: [2, 2] }).state).toBe('blocked')
    expect(ratingVariantStatus(first, roster, null).state).toBe('unknown')
  })

  it('does not infer live dormitory, mood, or training-task conditions from account ownership', () => {
    const variant = buildingRatingCombos.find((combo) => combo.id === 'rosmontis')!.variants[0]
    const roster = buildingRatingRoster(variant.members.map((member) => owned(member)))
    const match = ratingVariantStatus(variant, roster, config)
    expect(match.membersOwned).toBe(true)
    expect(match.state).toBe('unknown')
    expect(match.conditions.some((condition) => condition.key === 'dormOccupants' && condition.state === 'unknown')).toBe(true)
  })

  it('reuses the training calculator while preserving unknown level and ownership states', () => {
    const member = shamare.variants[0].members[0]
    expect(buildingRatingTrainingCost(member, null)).toMatchObject({ lmd: expect.any(Number), exp: expect.any(Number) })
    expect(buildingRatingTrainingCost(member, new Map())).toBeNull()
    expect(buildingRatingTrainingCost(member, buildingRatingRoster([owned(member, { elite: 0, level: undefined })]))).toBeNull()
    expect(buildingRatingTrainingCost(member, buildingRatingRoster([owned(member)]))).toEqual({ lmd: 0, exp: 0 })
  })
})
