import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitJob: vi.fn(),
  prepareOptimizeJob: vi.fn(),
  recordPersonalUseDeclarationUsage: vi.fn(),
}))

vi.mock('./prepare-job', () => ({ prepareOptimizeJob: mocks.prepareOptimizeJob }))
vi.mock('../../lifecycle', () => ({ getServiceLifecycleState: vi.fn(() => 'running') }))
vi.mock('../../storage/optimize-job-store', () => ({
  OptimizeJobAdmissionError: class OptimizeJobAdmissionError extends Error {},
  getOptimizeJobStore: () => ({ admitJob: mocks.admitJob }),
}))
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
vi.mock('../../optimize-job-signals', () => ({
  requestOptimizeJobCancellation: vi.fn(),
  requestOptimizeJobProcessing: vi.fn(),
}))
vi.mock('../../behavior-risk/service', () => ({
  recordRequestBehaviorEvent: vi.fn(),
}))

import { PersonalUseDeclarationRequiredError } from '../../storage/personal-use-declaration-store'
import { submitOptimizationJob } from './job-status'

describe('personal-use optimization admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareOptimizeJob.mockResolvedValue({
      ok: true,
      prepared: {
        payload: { version: 3, activeProfileId: 'profile-1' },
        ownerKey: 'profile:profile-1',
        priority: 'standard',
        priorityValue: 0,
        permission: 'free_preview',
        source: 'free_preview',
        personalUseAudit: { userId: 'user-1', profileId: 'profile-1' },
      },
    })
  })

  it('returns 428 before admission when the current declaration is not accepted', async () => {
    mocks.recordPersonalUseDeclarationUsage.mockRejectedValueOnce(new PersonalUseDeclarationRequiredError())

    const response = await submitOptimizationJob(request())

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'personal_use_declaration_required',
        message: '请先确认当前版本的个人使用声明。',
      },
    })
    expect(mocks.admitJob).not.toHaveBeenCalled()
  })

  it('fails closed before admission when the declaration store is unavailable', async () => {
    mocks.recordPersonalUseDeclarationUsage.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(submitOptimizationJob(request())).rejects.toThrow('database unavailable')
    expect(mocks.admitJob).not.toHaveBeenCalled()
  })
})

function request(): Request {
  return new Request('http://localhost/api/optimization/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'optimization-personal-use-1' },
    body: '{}',
  })
}
