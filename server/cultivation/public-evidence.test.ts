import { describe, expect, it } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { prtsSnapshotSchema } from './catalog'
import { calculateCultivationRecommendations } from './recommendations'
import { compactRecommendations } from './public-evidence'

function groupedResult() {
  const snapshot = prtsSnapshotSchema.parse(planningFixture())
  snapshot.operators.char_other = { ...snapshot.operators.char_test, name: '备选干员' }
  snapshot.homeworks = [{ ...snapshot.homeworks[0], content: {
    groups: [{ name: '任选', opers: ['测试干员', '备选干员'].map(name => ({ name, skill: 1,
      requirements: { elite: 1, level: 2, skill_level: 7, module: 0 } })) }],
  } }]
  return calculateCultivationRecommendations(snapshot, { ...defaultCultivationQuery,
    scope: 'history', days: 0, rarityGroup: 'all', includeUncertain: true,
  }, Date.parse(snapshot.updatedAt))
}

describe('compact recommendation groups', () => {
  it('preserves group contents, option order, canonical deduplication and caller objects', () => {
    const result = groupedResult()
    const branch = result.recommendations[0], sample = branch.samples[0]
    expect(sample.options).toHaveLength(2)
    const clone = structuredClone(sample)
    const changed = structuredClone(sample)
    changed.options[0].target.level += 1
    const invalid = { ...sample.options[0], operator: undefined, warnings: ['无法识别的干员'] }
    const samples = [sample, { ...sample, options: [...sample.options] }, clone,
      { ...sample, options: [...sample.options].reverse() }, changed,
      { ...sample, options: [...sample.options, invalid] }, { ...sample, group: 'other' }, sample]
    const input = { ...result, recommendations: [{ ...branch, samples }] }
    const before = structuredClone(input)
    const compact = compactRecommendations(input)
    const options = (entries: typeof sample.options) => entries
      .filter(row => row.operator && !row.warnings.length)
      .map(row => ({ operatorId: row.operator!.id, target: row.target,
        skillId: row.operator!.skills[row.target.skill - 1] ?? '' }))
    expect(compact.groups).toEqual([
      { key: sample.group, options: options(sample.options) },
      { key: sample.group, options: options([...sample.options].reverse()) },
      { key: sample.group, options: options(changed.options) },
      { key: 'other', options: options(sample.options) },
    ])
    expect(compact.samples.map(row => row[6])).toEqual([0, 0, 0, 1, 2, 0, 3])
    expect(compact.recommendations[0].samples).toEqual([0, 1, 2, 3, 4, 5, 6, 0])
    expect(input).toEqual(before)
    expect(compactRecommendations(input)).toEqual(compact)
    sample.options[0].target.level += 2
    expect(compactRecommendations(input).groups[0].options[0].target.level).toBe(sample.options[0].target.level)
  })
})
