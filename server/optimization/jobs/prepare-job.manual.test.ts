import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../src/lib/config'
import { createManualPlans } from '../../../src/lib/manual-schedule'
import type { LicenseOperator, OptimizeResult } from '../../../src/lib/types'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), baseline: vi.fn(), session: vi.fn(),
}))
vi.mock('../../handlers/user-auth', () => ({ requireUserSession: mocks.session }))
vi.mock('../../storage/user-store', async (original) => ({
  ...await original<typeof import('../../storage/user-store')>(), getProfileForUser: mocks.profile,
}))
vi.mock('../../storage/optimization-result-store', () => ({ getProfileOptimizationResult: mocks.baseline }))
vi.mock('../../handlers/profile-authorization', () => ({
  resolveProfileAuthorization: vi.fn(async () => ({ ok: true, permission: 'advanced', cdkRecord: null })),
}))
vi.mock('../../feature-gate', () => ({ requireMeteredBillingFeature: vi.fn(async () => null) }))
vi.mock('./job-status', () => ({
  resolveOptimizeDurationEstimate: vi.fn(async (bucket) => ({
    estimated_duration_ms: 1000, estimate_bucket: bucket, estimate_source: 'fallback_p95', estimate_sample_count: 0,
  })),
  getOptimizeEstimateBucket: vi.fn(), getEstimateScheduleMode: vi.fn(),
  isEstimateFiammettaEnabled: vi.fn(), buildScenarioComparisonEstimate: vi.fn(),
}))
vi.mock('./entitlements', async (original) => ({
  ...await original<typeof import('./entitlements')>(), recordScheduleGenerate: vi.fn(async () => undefined),
}))
import { prepareOptimizeJob } from './prepare-job'

const operators: LicenseOperator[] = ['芬', '克洛丝'].map((name) => ({
  id: name, name, own: true, elite: 1, rarity: 3,
}))
const source: OptimizeResult = {
  author: 'test', title: 'Baseline', description: '', buildingType: 243, planTimes: '8×3',
  raw_results: [], plans: [{ name: 'Shift', rooms: {
    manufacture: [{ level: 3, product: 'Battle Record', operators: ['芬'], efficiency: 999 }],
  } }],
}
const config = CONFIG_PRESETS['243']
function request(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://local/api/optimization/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'schedule', identity: { type: 'profile', profileId: 'profile-1' },
      config, operators, includeUpgradeSuggestions: false,
      manualSchedule: { baselineHistoryId: 'history-1', plans: createManualPlans(source) },
      ...overrides,
    }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'user-1' }, tokenHash: 'session' })
  mocks.profile.mockResolvedValue({ id: 'profile-1', kind: 'cdk', permission: 'advanced' })
  mocks.baseline.mockResolvedValue({ id: 'history-1', result: source, config, archived_at: null })
})
describe('manual schedule admission', () => {
  it('derives fixed-plan input and configuration from the owned baseline without billing or workspace effects', async () => {
    const result = await prepareOptimizeJob(request())
    expect(result.ok).toBe(true)
    if (!result.ok || 'kind' in result.prepared.payload) throw new Error('Expected schedule admission')
    expect(mocks.profile).toHaveBeenCalledWith('user-1', 'profile-1')
    expect(mocks.baseline).toHaveBeenCalledWith('profile-1', 'history-1')
    expect(result.prepared.billing).toBeUndefined()
    expect(result.prepared.payload.request.manual_schedule?.plans[0].rooms.manufacture[0]).toEqual({
      level: 3, product: 'Battle Record', operators: ['芬'], autofill: undefined,
    })
    expect(result.prepared.payload.request.include_upgrade_suggestions).toBe(false)
    expect(result.prepared.payload.effectiveConfig).toMatchObject({ layout: config.layout })
  })
  it('rejects missing or archived baselines and preview profiles', async () => {
    mocks.baseline.mockResolvedValueOnce(null)
    expect((await prepareOptimizeJob(request())).ok).toBe(false)
    mocks.baseline.mockResolvedValueOnce({ result: source, config, archived_at: '2026-09-30' })
    expect((await prepareOptimizeJob(request())).ok).toBe(false)
    mocks.profile.mockResolvedValueOnce({ id: 'profile-1', kind: 'free_preview', permission: 'advanced' })
    expect((await prepareOptimizeJob(request())).ok).toBe(false)
  })
  it('retains personal-use auditing for metered profiles without requiring a generation quote', async () => {
    mocks.profile.mockResolvedValueOnce({ id: 'profile-1', kind: 'metered_personal', permission: 'metered_advanced' })
    const result = await prepareOptimizeJob(request())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected manual simulation admission')
    expect(result.prepared.personalUseAudit).toEqual({ userId: 'user-1', profileId: 'profile-1' })
    expect(result.prepared.billing).toBeUndefined()
    expect(result.prepared.behaviorIdentity).toEqual({ userId: 'user-1', sessionTokenHash: 'session' })
  })
  it('rejects duplicates, incorrect room capacities and unsupported simulation options', async () => {
    const plans = createManualPlans(source)
    plans[0].rooms.manufacture[0] = ['芬', '芬', '']
    expect((await prepareOptimizeJob(request({ manualSchedule: { baselineHistoryId: 'history-1', plans } }))).ok).toBe(false)
    plans[0].rooms.manufacture[0] = ['芬']
    expect((await prepareOptimizeJob(request({ manualSchedule: { baselineHistoryId: 'history-1', plans } }))).ok).toBe(false)
    expect((await prepareOptimizeJob(request({ includeUpgradeSuggestions: true }))).ok).toBe(false)
  })
})
