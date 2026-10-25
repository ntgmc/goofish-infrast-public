import { describe, expect, it } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import type { CultivationStatistics } from '../../src/lib/cultivation-contract'
import { prtsSnapshotSchema } from './catalog'
import { cultivationCommunityScore } from './scoring'

const snapshot = () => {
  const input = prtsSnapshotSchema.parse(planningFixture())
  input.costs.modules.equipDict.mod_x.typeName2 = 'X'
  input.costs.modules.equipDict.mod_y = { ...input.costs.modules.equipDict.mod_x, typeName2: 'Y' }
  return input
}
const statistics = (overrides: Partial<CultivationStatistics> = {}): CultivationStatistics => ({
  owned: 200, sampleSize: 1000, elite: [0, 0.2, 0.8], skills: [[0.4, 0, 0, 0.6]], modules: { X: [0.5, 0, 0, 0.5] }, ...overrides,
})

describe('cultivation community strength', () => {
  it('prefers specialist investment over ownership and elite promotion alone', () => {
    const input = snapshot()
    const popular = statistics({ owned: 900, elite: [0, 0.05, 0.95], skills: [[0.9, 0, 0, 0.1]], modules: { X: [1, 0, 0, 0] } })
    const trained = statistics({ owned: 100, elite: [0, 0.3, 0.7] })
    expect(cultivationCommunityScore(input, 'char_test', trained)).toBeGreaterThan(cultivationCommunityScore(input, 'char_test', popular)!)
    expect(cultivationCommunityScore(input, 'char_test', trained)).toBe(cultivationCommunityScore(input, 'char_test', { ...trained, owned: 900, sampleSize: 2000 }))
  })

  it('values both module opening and upgrades without adding competing branches together', () => {
    const input = snapshot()
    const score = (modules: CultivationStatistics['modules']) => cultivationCommunityScore(input, 'char_test', statistics({ modules }))!
    const closed = score({ X: [1, 0, 0, 0] })
    const opened = score({ X: [0.4, 0.6, 0, 0] })
    const rankTwo = score({ X: [0.4, 0, 0.6, 0] })
    const rankThree = score({ X: [0.4, 0, 0, 0.6] })
    expect(opened).toBeGreaterThan(closed)
    expect(rankTwo).toBeGreaterThan(opened)
    expect(rankThree).toBeGreaterThan(rankTwo)
    expect(score({ X: [0.4, 0, 0, 0.6], Y: [0.4, 0, 0, 0.6] })).toBe(rankThree)
    const single = statistics()
    expect(cultivationCommunityScore(input, 'char_test', { ...single, skills: [...single.skills, ...single.skills] })).toBe(cultivationCommunityScore(input, 'char_test', single))
  })

  it('allows operators without modules to reach the full score', () => {
    const input = snapshot()
    input.costs.modules.charEquip.char_test = ['original']
    expect(cultivationCommunityScore(input, 'char_test', statistics({ elite: [0, 0, 1], skills: [[0, 0, 0, 1]], modules: {} }))).toBe(1)
    input.costs.modules.charEquip.char_test = ['mod_x']
    expect(cultivationCommunityScore(input, 'char_test', statistics({ elite: [0, 0, 1], skills: [[0, 0, 0, 1]], modules: { X: [0, 0, 0, 1] } }))).toBe(1)
  })

  it('leaves missing and small samples unscored', () => {
    const input = snapshot()
    expect(cultivationCommunityScore(input, 'char_test', undefined)).toBeNull()
    expect(cultivationCommunityScore(input, 'char_test', statistics({ owned: 99 }))).toBeNull()
    expect(cultivationCommunityScore(input, 'char_test', statistics({ owned: 100 }))).not.toBeNull()
  })
})
