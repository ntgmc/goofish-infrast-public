import { afterAll, describe, expect, it } from 'vitest'
import { buildScenarioComparisonEstimate, createOptimizeJobPollToken, verifyOptimizeJobPollToken } from './job-status'
import { createPersistedOptimizeJobPayload } from './shared'

const originalAdminSecret = process.env.MAA_ADMIN_SECRET
const originalPreviousAdminSecret = process.env.MAA_ADMIN_SECRET_PREVIOUS

afterAll(() => {
  if (originalAdminSecret === undefined) delete process.env.MAA_ADMIN_SECRET
  else process.env.MAA_ADMIN_SECRET = originalAdminSecret
  if (originalPreviousAdminSecret === undefined) delete process.env.MAA_ADMIN_SECRET_PREVIOUS
  else process.env.MAA_ADMIN_SECRET_PREVIOUS = originalPreviousAdminSecret
})

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

describe('optimization job capability tokens', () => {
  it('binds a token to both the job and owner and accepts the previous signing secret', () => {
    process.env.MAA_ADMIN_SECRET = 'current-job-token-secret'
    const job = { id: 'job-1', owner_key: 'license:owner-a' }
    const token = createOptimizeJobPollToken(job)

    expect(verifyOptimizeJobPollToken(job, token)).toBe(true)
    expect(verifyOptimizeJobPollToken({ ...job, id: 'job-2' }, token)).toBe(false)
    expect(verifyOptimizeJobPollToken({ ...job, owner_key: 'license:owner-b' }, token)).toBe(false)
    expect(verifyOptimizeJobPollToken(job, `${token.slice(0, -1)}0`)).toBe(false)

    process.env.MAA_ADMIN_SECRET_PREVIOUS = 'current-job-token-secret'
    process.env.MAA_ADMIN_SECRET = 'rotated-job-token-secret'
    expect(verifyOptimizeJobPollToken(job, token)).toBe(true)
  })
})

describe('persisted optimization payload', () => {
  it('contains only the minimum authorization and usage references', () => {
    const payload = createPersistedOptimizeJobPayload({
      submittedAt: 1,
      operators: [],
      effectiveConfig: {},
      configPermission: 'growth',
      cdkUsageRef: { code_hash: 'hash-only' },
      scheduleUsageBase: { permission: 'growth' },
      activeProfileId: null,
      isPreviewProfile: false,
      isPreviewTrial: false,
      freeScheduleDecision: null,
      estimate: { estimated_duration_ms: 2_000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0 },
      request: {},
    })
    const serialized = JSON.stringify(payload)

    expect(payload).toMatchObject({ version: 3, configPermission: 'growth', cdkUsageRef: { code_hash: 'hash-only' } })
    expect(serialized).not.toContain('effectiveLicense')
    expect(serialized).not.toContain('checkedCdkRecord')
    expect(serialized).not.toContain('activation_token')
    expect(serialized).not.toContain('"sig"')
  })
})
