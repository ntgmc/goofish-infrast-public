import { describe, expect, it } from 'vitest'
import { buildScenarioComparisonEstimate } from './job-status'

describe('scenario comparison estimates', () => {
  it('charges variable scenarios for their bounded fast-search candidates', () => {
    const fixed = buildScenarioComparisonEstimate(4, 0)
    const oneVariable = buildScenarioComparisonEstimate(4, 1)
    expect(fixed.estimated_duration_ms).toBe(52_000)
    expect(oneVariable.estimated_duration_ms).toBe(100_000)
  })

  it('allows the worst 24-variable workload beyond the ordinary ten-minute cap', () => {
    expect(buildScenarioComparisonEstimate(24, 24).estimated_duration_ms).toBe(1_329_000)
  })
})
