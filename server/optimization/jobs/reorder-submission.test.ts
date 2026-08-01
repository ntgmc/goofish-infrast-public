import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitJob: vi.fn(),
  requestProcessing: vi.fn(),
  recordEvent: vi.fn(),
  recordPersonalUseDeclarationUsage: vi.fn(),
  body: {
    profileId: 'profile-1',
    config: { Fiammetta: { enable: false } },
    baselineHistoryId: 'history-1',
  },
}))

vi.mock('../../handlers/user-auth', () => ({
  requireUserSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))
vi.mock('../../handlers/license-utils', () => ({
  formatRiskFreezeMessage: (message: string) => message,
  resolveConfigForPermission: (_permission: string, config: unknown) => ({ ok: true, config }),
  resolveFreePreviewConfig: (config: unknown) => ({ ok: true, config }),
}))
vi.mock('../../handlers/profile-authorization', () => ({
  resolveProfileAuthorization: vi.fn(async () => ({
    ok: true,
    permission: 'growth',
    cdkRecord: null,
  })),
}))
vi.mock('../../free-preview-trial', () => ({ isFreePreviewTrialActive: vi.fn(() => false) }))
vi.mock('../../lifecycle', () => ({ getServiceLifecycleState: vi.fn(() => 'running') }))
vi.mock('../../optimize-job-signals', () => ({ requestOptimizeJobProcessing: mocks.requestProcessing }))
vi.mock('../../security/request-policy', () => ({ requestSchemas: { reorderCheck: {} } }))
vi.mock('../../security/request-validation', () => ({
  getValidatedJson: vi.fn(async () => mocks.body),
  stableJsonStringify: (value: unknown) => JSON.stringify(value),
}))
vi.mock('../../storage/optimize-job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage/optimize-job-store')>()
  return { ...actual, getOptimizeJobStore: () => ({ admitJob: mocks.admitJob }) }
})
vi.mock('../../storage/personal-use-declaration-store', () => ({
  PersonalUseDeclarationRequiredError: class PersonalUseDeclarationRequiredError extends Error {
    readonly code = 'personal_use_declaration_required'
    readonly status = 428

    constructor() {
      super('请先确认当前版本的个人使用声明。')
    }
  },
  recordPersonalUseDeclarationUsage: mocks.recordPersonalUseDeclarationUsage,
}))
vi.mock('../../storage/user-store', () => ({
  getProfileForUser: vi.fn(async () => ({
    id: 'profile-1',
    status: 'active',
    permission: 'free_preview',
    skland_binding: { uid: 'uid-1' },
  })),
  isFreePreviewProfile: vi.fn(() => true),
  getWorkspace: vi.fn(async () => ({
    operators: [{ id: 'char-1', name: '测试干员' }],
    result_history: [{
      id: 'history-1',
      name: '历史方案',
      created_at: '2026-07-01T00:00:00.000Z',
      config: {},
      result: {},
      operator_count: 1,
      source: 'generated',
    }],
  })),
  emptyWorkspace: vi.fn(),
}))
vi.mock('./entitlements', () => ({
  getReorderCheckQuota: vi.fn(async () => ({ limit: 2, used: 2, remaining: 0, reset_at: '2026-08-01T00:00:00.000Z' })),
}))
vi.mock('./job-status', () => ({
  buildOptimizeJobAccepted: vi.fn(async () => ({ id: 'job-1', kind: 'reorder_check', status: 'queued' })),
  getOptimizeEstimateBucket: vi.fn(() => 'maa_plain'),
  resolveOptimizeDurationEstimate: vi.fn(async () => ({
    estimated_duration_ms: 9_000,
    estimate_bucket: 'maa_plain',
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  })),
}))
vi.mock('./http-core', () => ({
  sanitizeConfigForPublicOptimize: (config: unknown) => config,
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}))
vi.mock('./reorder-telemetry', () => ({ recordReorderCheckEvent: mocks.recordEvent }))

import { OptimizeJobAdmissionError } from '../../storage/optimize-job-store'
import { PersonalUseDeclarationRequiredError } from '../../storage/personal-use-declaration-store'
import { submitReorderCheck } from './reorder-submission'

describe('reorder check submission', () => {
  beforeEach(() => {
    mocks.admitJob.mockReset()
    mocks.requestProcessing.mockReset()
    mocks.recordEvent.mockReset()
    mocks.recordPersonalUseDeclarationUsage.mockReset()
    mocks.recordPersonalUseDeclarationUsage.mockResolvedValue({ declaration_version: 'V1.1' })
    mocks.admitJob.mockResolvedValue({ job: { id: 'job-1' }, replayed: false })
  })

  it('freezes the input snapshot, reserves quota, and returns an async job', async () => {
    const response = await submitReorderCheck(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ job: { id: 'job-1', kind: 'reorder_check', status: 'queued' } })
    expect(mocks.admitJob).toHaveBeenCalledWith(expect.objectContaining({
      owner_key: 'reorder-job:profile-1',
      profile_id: 'profile-1',
      source: 'reorder_check',
      reorderCheckQuota: expect.objectContaining({ profileId: 'profile-1', limit: 2 }),
      payload_json: expect.objectContaining({
        version: 3,
        kind: 'reorder_check',
        activeProfileId: 'profile-1',
        operators: [{ id: 'char-1', name: '测试干员' }],
        baseline: expect.objectContaining({ id: 'history-1' }),
      }),
    }))
    expect(mocks.requestProcessing).toHaveBeenCalledTimes(1)
    expect(mocks.recordPersonalUseDeclarationUsage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      profileId: 'profile-1',
      action: 'reorder_check',
    }))
    expect(mocks.recordPersonalUseDeclarationUsage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.admitJob.mock.invocationCallOrder[0]!,
    )
  })

  it('rejects an unconfirmed profile before job admission', async () => {
    mocks.recordPersonalUseDeclarationUsage.mockRejectedValueOnce(new PersonalUseDeclarationRequiredError())

    const response = await submitReorderCheck(request())

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toEqual({
      error: '请先确认当前版本的个人使用声明。',
      code: 'personal_use_declaration_required',
    })
    expect(mocks.admitJob).not.toHaveBeenCalled()
    expect(mocks.requestProcessing).not.toHaveBeenCalled()
  })

  it('returns the monthly quota error before signaling the worker', async () => {
    mocks.admitJob.mockRejectedValueOnce(
      new OptimizeJobAdmissionError('reorder_check_quota_exceeded', 429, '本月重排检测次数已用完。'),
    )

    const response = await submitReorderCheck(request())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      code: 'reorder_check_quota_exceeded',
      quota: { used: 2, remaining: 0 },
    })
    expect(mocks.requestProcessing).not.toHaveBeenCalled()
  })
})

function request(): Request {
  return new Request('http://localhost/api/optimization/reorder-checks', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'reorder-key-1' },
    body: JSON.stringify(mocks.body),
  })
}
