import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  applyScheduleGenerateEffects: vi.fn(),
  recordGeneratedBehaviorEvent: vi.fn(),
  getTrackedGenerationEvent: vi.fn(),
}))

vi.mock('../../storage/postgres', () => ({
  hasDatabaseUrl: () => true,
  query: mocks.query,
}))
vi.mock('./entitlements', () => ({
  applyScheduleGenerateEffects: mocks.applyScheduleGenerateEffects,
}))
vi.mock('../../behavior-risk/service', () => ({
  recordGeneratedBehaviorEvent: mocks.recordGeneratedBehaviorEvent,
}))
vi.mock('../../storage/behavior-risk-store', () => ({
  getTrackedGenerationEvent: mocks.getTrackedGenerationEvent,
}))

import { processPendingOptimizationJobEffects } from './job-effects'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.applyScheduleGenerateEffects.mockResolvedValue(undefined)
  mocks.recordGeneratedBehaviorEvent.mockResolvedValue(true)
  mocks.getTrackedGenerationEvent.mockResolvedValue(null)
})

describe('optimization completion effect outbox', () => {
  it('applies idempotent usage/CDK and generate behavior effects before marking the outbox row applied', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [pendingEffect()] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await expect(processPendingOptimizationJobEffects('job-1')).resolves.toBe(1)

    expect(mocks.applyScheduleGenerateEffects).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ status: 'success', reason_code: 'ok', profile_id: 'profile-1' }),
      expect.objectContaining({ submittedAt: 1 }),
      'job-1',
    )
    expect(mocks.recordGeneratedBehaviorEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      profileId: 'profile-1',
      jobId: 'job-1',
      result: expect.objectContaining({ title: 'result' }),
    }))
    expect(JSON.parse(String(mocks.query.mock.calls[1]?.[1]?.[2]))).toMatchObject({ status: 'applied' })
  })
})

function pendingEffect() {
  return {
    job_id: 'job-1',
    profile_id: 'profile-1',
    user_id: 'user-1',
    started_at: '1970-01-01T00:00:00.010Z',
    profile_record: { skland_binding: { uid: '123456' } },
    payload_json: {
      version: 3,
      submittedAt: 1,
      operators: [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }],
      effectiveConfig: {
        layout: '243', desc: 'test', schedule_mode: 'maa', trading_stations_count: 2,
        manufacturing_stations_count: 4,
        product_requirements: { trading_stations: { lmd: 2 }, manufacturing_stations: { pure_gold: 4 } },
      },
      scheduleUsageBase: {}, activeProfileId: 'profile-1', isPreviewProfile: false, isPreviewTrial: false,
      freeScheduleDecision: null,
      estimate: { estimated_duration_ms: 2_000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0 },
      request: { include_upgrade_suggestions: false, upgrade_suggestions_allowed: false },
      configPermission: 'advanced', cdkUsageRef: null,
    },
    result_json: {
      author: 'test', title: 'result', description: 'result', buildingType: 2, planTimes: '8h', plans: [], raw_results: [],
    },
  }
}
