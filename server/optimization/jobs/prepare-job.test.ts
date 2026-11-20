import { describe, expect, it } from 'vitest'
import { getScenarioComparisonQueuePriority } from './prepare-job'

describe('scenario comparison queue priority', () => {
  it('uses standard queue weight for the free advanced preview trial', () => {
    expect(getScenarioComparisonQueuePriority(true, true)).toEqual({
      kind: 'standard',
      value: 0,
    })
  })

  it('keeps analysis queue weight for non-preview entitled profiles', () => {
    expect(getScenarioComparisonQueuePriority(false, false)).toEqual({
      kind: 'analysis',
      value: 5,
    })
    expect(getScenarioComparisonQueuePriority(false, true)).toEqual({
      kind: 'analysis',
      value: 5,
    })
  })
})
