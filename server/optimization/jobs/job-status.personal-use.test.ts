import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitJob: vi.fn(),
  findIdempotentJob: vi.fn(),
  getQueuePosition: vi.fn(),
  prepareOptimizeJob: vi.fn(),
  recordPersonalUseDeclarationUsage: vi.fn(),
  recordRequestBehaviorEvent: vi.fn(),
  requestOptimizeJobProcessing: vi.fn(),
  requireUserSession: vi.fn(),
  getProfileForUser: vi.fn(),
}))

vi.mock('./prepare-job', () => ({ prepareOptimizeJob: mocks.prepareOptimizeJob }))
vi.mock('../../lifecycle', () => ({ getServiceLifecycleState: vi.fn(() => 'running') }))
vi.mock('../../storage/optimize-job-store', () => ({
  OptimizeJobAdmissionError: class OptimizeJobAdmissionError extends Error {},
  getOptimizeJobStore: () => ({
    admitJob: mocks.admitJob,
    findIdempotentJob: mocks.findIdempotentJob,
    getQueuePosition: mocks.getQueuePosition,
  }),
}))
vi.mock('../../handlers/user-auth', () => ({ requireUserSession: mocks.requireUserSession }))
vi.mock('../../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
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
  requestOptimizeJobProcessing: mocks.requestOptimizeJobProcessing,
}))
vi.mock('../../behavior-risk/service', () => ({
  recordRequestBehaviorEvent: mocks.recordRequestBehaviorEvent,
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
    mocks.findIdempotentJob.mockResolvedValue(null)
    mocks.getQueuePosition.mockResolvedValue(1)
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getProfileForUser.mockResolvedValue({ id: 'profile-1' })
    mocks.recordRequestBehaviorEvent.mockResolvedValue(true)
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

  it('returns an accepted replay before mutable preparation and hashes equivalent JSON canonically', async () => {
    const replayed = jobRecord()
    mocks.findIdempotentJob.mockResolvedValue(replayed)

    const first = await submitOptimizationJob(requestWithBody('{"kind":"schedule","identity":{"type":"profile","profileId":"profile-1"},"operators":[],"config":{},"includeUpgradeSuggestions":false}'))
    const firstHash = mocks.findIdempotentJob.mock.calls[0]?.[2]
    const second = await submitOptimizationJob(requestWithBody('{"identity":{"profileId":"profile-1","type":"profile"},"includeUpgradeSuggestions":false,"config":{},"operators":[],"kind":"schedule"}'))
    const secondHash = mocks.findIdempotentJob.mock.calls[1]?.[2]

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(firstHash).toBe(secondHash)
    expect(mocks.prepareOptimizeJob).not.toHaveBeenCalled()
    expect(mocks.admitJob).not.toHaveBeenCalled()
    expect(mocks.recordPersonalUseDeclarationUsage).not.toHaveBeenCalled()
  })

  it('returns the committed job and signals processing when submit behavior storage fails', async () => {
    mocks.prepareOptimizeJob.mockResolvedValueOnce({
      ok: true,
      prepared: {
        payload: { version: 3, activeProfileId: 'profile-1' },
        ownerKey: 'profile:profile-1',
        priority: 'paid',
        priorityValue: 10,
        permission: 'advanced',
        source: 'account_profile',
        behaviorIdentity: { userId: 'user-1', sessionTokenHash: 'session-hash' },
      },
    })
    mocks.admitJob.mockResolvedValueOnce({ job: jobRecord(), replayed: false })
    mocks.recordRequestBehaviorEvent.mockRejectedValueOnce(new Error('behavior database unavailable'))

    const response = await submitOptimizationJob(request())

    expect(response.status).toBe(202)
    expect(mocks.requestOptimizeJobProcessing).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(mocks.recordRequestBehaviorEvent).toHaveBeenCalledOnce()
  })
})

function request(): Request {
  return requestWithBody('{}')
}

function requestWithBody(body: string): Request {
  return new Request('http://localhost/api/optimization/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'optimization-personal-use-1' },
    body,
  })
}

function jobRecord() {
  return {
    id: 'job-1', status: 'queued', priority: 10, owner_key: 'profile:profile-1', profile_id: 'profile-1',
    billing_user_id: null, billing_json: null, permission: 'advanced', source: 'account_profile',
    payload_json: { version: 3 }, result_json: null, error_message: null, failure_kind: null,
    public_error_code: null, attempt_count: 0, failure_count: 0, worker_id: null, heartbeat_at: null,
    lock_token: null, lock_expires_at: null, next_attempt_at: '2026-07-31T00:00:00.000Z',
    expires_at: '2026-08-01T00:00:00.000Z', cancel_requested_at: null, execution_stage: null,
    stage_updated_at: null, created_at: '2026-07-31T00:00:00.000Z', started_at: null,
    finished_at: null, updated_at: '2026-07-31T00:00:00.000Z',
  }
}
