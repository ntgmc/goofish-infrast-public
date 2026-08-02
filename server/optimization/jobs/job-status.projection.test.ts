import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  getQueuePosition: vi.fn(),
  getProfileForUser: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../../storage/optimize-job-store', () => ({
  OptimizeJobAdmissionError: class OptimizeJobAdmissionError extends Error {},
  getOptimizeJobStore: () => ({
    getJob: mocks.getJob,
    getQueuePosition: mocks.getQueuePosition,
  }),
}))
vi.mock('../../handlers/user-auth', () => ({ requireUserSession: mocks.requireUserSession }))
vi.mock('../../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  normalizeProfileKind: (profile: { kind?: string }) => profile.kind ?? 'cdk',
}))
vi.mock('../../handlers/profile-authorization', () => ({
  resolveProfileAuthorization: vi.fn(async (profile: { permission: string }) => ({
    ok: true,
    permission: profile.permission,
    cdkRecord: null,
  })),
}))

import { getOptimizationJob } from './job-status'

describe('optimization job result projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getJob.mockResolvedValue(jobRecord())
    mocks.getQueuePosition.mockResolvedValue(null)
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getProfileForUser.mockResolvedValue({
      id: 'profile-1',
      kind: 'cdk',
      permission: 'recommended',
    })
  })

  it('does not expose full or raw result data to a recommended profile owner', async () => {
    const response = await getOptimizationJob(request(), 'job-1')

    expect(response.status).toBe(200)
    const snapshot = await response.json()
    expect(snapshot.historyResultId).toBe('job-1')
    expect(snapshot.result).toMatchObject({ title: '测试结果', raw_results: [] })
    expect(snapshot.result).not.toHaveProperty('daily_production')
    expect(snapshot.result).not.toHaveProperty('total_efficiency')
  })

  it('keeps complete result data for an advanced profile owner', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      id: 'profile-1',
      kind: 'cdk',
      permission: 'advanced',
    })

    const response = await getOptimizationJob(request(), 'job-1')

    expect(response.status).toBe(200)
    const snapshot = await response.json()
    expect(snapshot.result.raw_results).toHaveLength(1)
    expect(snapshot.result.daily_production).toBeDefined()
    expect(snapshot.result.total_efficiency).toBe(100)
  })
})

function request(): Request {
  return new Request('http://localhost/api/optimization/jobs/job-1')
}

function jobRecord() {
  return {
    id: 'job-1', status: 'succeeded', priority: 10, owner_key: 'profile:profile-1', profile_id: 'profile-1',
    billing_user_id: null, billing_json: null, permission: 'advanced', source: 'account_profile',
    payload_json: { version: 3 }, result_json: {
      author: '测试', title: '测试结果', description: '测试说明', buildingType: 253, planTimes: '1 班',
      plans: [{ name: '第 1 班', rooms: {} }],
      raw_results: [{ total_efficiency: 100, assignment_detail: [] }],
      daily_production: { manufacturing: { LMD: 1000 } },
      total_efficiency: 100,
    }, error_message: null, failure_kind: null,
    public_error_code: null, attempt_count: 1, failure_count: 0, worker_id: null, heartbeat_at: null,
    lock_token: null, lock_expires_at: null, next_attempt_at: null,
    expires_at: null, cancel_requested_at: null, execution_stage: 'completed',
    stage_updated_at: '2026-08-02T00:01:00.000Z', created_at: '2026-08-02T00:00:00.000Z',
    started_at: '2026-08-02T00:00:01.000Z', finished_at: '2026-08-02T00:01:00.000Z',
    updated_at: '2026-08-02T00:01:00.000Z',
  }
}
