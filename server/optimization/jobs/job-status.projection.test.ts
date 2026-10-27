import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  requestCancel: vi.fn(),
  query: vi.fn(),
  listJobsByProfile: vi.fn(),
  getQueuePosition: vi.fn(),
  getProfileForUser: vi.fn(),
  requireUserSession: vi.fn(),
  findIdempotentJob: vi.fn(),
  resolveProfileAuthorization: vi.fn(),
}))

vi.mock('../../storage/optimize-job-store', () => ({
  OptimizeJobAdmissionError: class OptimizeJobAdmissionError extends Error {},
  getOptimizeJobStore: () => ({
    getJob: mocks.getJob,
    requestCancel: mocks.requestCancel,
    findIdempotentJob: mocks.findIdempotentJob,
    listJobsByProfile: mocks.listJobsByProfile,
    getQueuePosition: mocks.getQueuePosition,
  }),
}))
vi.mock('../../handlers/user-auth', () => ({ requireUserSession: mocks.requireUserSession }))
vi.mock('../../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  normalizeProfileKind: (profile: { kind?: string }) => profile.kind ?? 'cdk',
}))
vi.mock('../../handlers/profile-authorization', () => ({
  resolveProfileAuthorization: mocks.resolveProfileAuthorization,
}))

vi.mock('../../storage/postgres', async (original) => ({
  ...await original<typeof import('../../storage/postgres')>(), query: mocks.query,
}))

import { cancelOptimizationJob, getOptimizationJob, listOptimizationJobs, submitOptimizationJob } from './job-status'

describe('optimization job result projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getJob.mockResolvedValue(jobRecord())
    mocks.requestCancel.mockResolvedValue(jobRecord())
    mocks.query.mockResolvedValue({ rows: [{ entitled: false }] })
    mocks.findIdempotentJob.mockResolvedValue(jobRecord())
    mocks.resolveProfileAuthorization.mockImplementation(async (profile: { permission: string }) => ({
      ok: true, permission: profile.permission, cdkRecord: null,
    }))
    mocks.getQueuePosition.mockResolvedValue(null)
    mocks.listJobsByProfile.mockResolvedValue([{ job: jobSummary(), resultAvailable: true, queuePosition: null }])
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getProfileForUser.mockResolvedValue({
      id: 'profile-1',
      kind: 'cdk',
      permission: 'recommended',
    })
  })

  it.each([null, 'job-1'])('reports schedule result availability from persisted history (%s)', async (historyResultId) => {
    mocks.listJobsByProfile.mockResolvedValue([{ job: jobSummary(), resultAvailable: true, queuePosition: null, historyResultId }])
    const response = await listOptimizationJobs(new Request('http://localhost/api/optimization/jobs?profile_id=profile-1'))
    expect(response.status).toBe(200)
    const { jobs } = await response.json()
    expect(jobs[0]).toMatchObject({ status: 'succeeded', resultAvailable: Boolean(historyResultId) })
    expect(jobs[0].historyResultId).toBe(historyResultId ?? undefined)
    expect(jobs[0]).not.toHaveProperty('result')
  })

  it.each([false, true])('reports scenario result availability without loading its result (%s)', async (resultAvailable) => {
    const job = { ...jobSummary(), source: 'scenario_comparison', payload_json: { kind: 'scenario_comparison' } }
    mocks.listJobsByProfile.mockResolvedValue([{ job, resultAvailable, queuePosition: null }])
    const response = await listOptimizationJobs(new Request('http://localhost/api/optimization/jobs?profile_id=profile-1'))
    const { jobs } = await response.json()
    expect(jobs[0]).toMatchObject({ kind: 'scenario_comparison', status: 'succeeded', resultAvailable })
    expect(jobs[0]).not.toHaveProperty('result')
    expect(jobs[0]).not.toHaveProperty('historyResultId')
  })

  it.each(['running', 'succeeded', 'failed', 'cancelled', 'dead_lettered'])('skips queue estimates for %s status', async (status) => {
    mocks.getJob.mockResolvedValue({ ...jobRecord(), status })
    const response = await getOptimizationJob(request(), 'job-1')
    expect(response.status).toBe(200)
    expect((await response.json()).queuePosition).toBeNull()
    expect(mocks.getQueuePosition).not.toHaveBeenCalled()
  })

  it('still estimates a queued job', async () => {
    mocks.getJob.mockResolvedValue({ ...jobRecord(), status: 'queued' })
    mocks.getQueuePosition.mockResolvedValue(2)
    const response = await getOptimizationJob(request(), 'job-1')
    expect((await response.json()).queuePosition).toBe(2)
    expect(mocks.getQueuePosition).toHaveBeenCalledWith('job-1')
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

  it('projects an idempotent submission using the downgraded current permission', async () => {
    const response = await submitOptimizationJob(replayRequest())
    expect(response.status).toBe(202)
    const { job } = await response.json()
    expect(job.result.raw_results).toEqual([])
    expect(job.result).not.toHaveProperty('daily_production')
    expect(job.result).not.toHaveProperty('total_efficiency')
  })

  it('keeps purchased diagnosis in GET and replay without unlocking full data', async () => {
    mocks.query.mockResolvedValue({ rows: [{ entitled: true }] })
    for (const response of [await getOptimizationJob(request(), 'job-1'), await submitOptimizationJob(replayRequest())]) {
      const body = await response.json()
      const snapshot = body.job ?? body
      expect(snapshot.result.upgrade_suggestions).toHaveLength(1)
      expect(snapshot.result.raw_results).toEqual([])
      expect(snapshot.result).not.toHaveProperty('total_efficiency')
    }
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("reward_type = 'training_diagnosis_coupon'"), ['job-1'])
  })

  it('projects a successful result returned by cancellation after a running snapshot', async () => {
    mocks.getJob.mockResolvedValue({ ...jobRecord(), status: 'running', result_json: null })
    const response = await cancelOptimizationJob(request(), 'job-1')
    expect(response.status).toBe(202)
    const { job } = await response.json()
    expect(job.status).toBe('succeeded')
    expect(job.result.raw_results).toEqual([])
    expect(job.result).not.toHaveProperty('total_efficiency')
    expect(job.result).not.toHaveProperty('upgrade_suggestions')
  })

  it('rejects both GET and submission replay after the profile is frozen', async () => {
    mocks.resolveProfileAuthorization.mockResolvedValue({ ok: false, status: 403, message: '该游戏账号已冻结。' })
    const replay = await submitOptimizationJob(replayRequest())
    const read = await getOptimizationJob(request(), 'job-1')
    expect(replay.status).toBe(403)
    expect(await replay.json()).toEqual(await read.json())
    expect(read.status).toBe(403)
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

  it('exposes aggregate production to a free-preview owner without exposing raw results', async () => {
    mocks.getProfileForUser.mockResolvedValue({ id: 'profile-1', kind: 'free_preview', permission: 'growth' })
    const response = await getOptimizationJob(request(), 'job-1')
    expect(response.status).toBe(200)
    const snapshot = await response.json()
    expect(snapshot.result.daily_production.manufacturing).toEqual({ LMD: 1000 })
    expect(snapshot.result.daily_production).not.toHaveProperty('details')
    expect(snapshot.result.raw_results).toEqual([])
  })
})

function jobSummary() {
  const { result_json: _result, ...summary } = jobRecord()
  return summary
}

function replayRequest(): Request {
  return new Request('http://localhost/api/optimization/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'previous-job' },
    body: JSON.stringify({ identity: { type: 'profile', profileId: 'profile-1' } }),
  })
}

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
      upgrade_suggestions: [{ type: 'single', name: 'Operator', current: 1, target: 2, gain: 1 }],
    }, error_message: null, failure_kind: null,
    public_error_code: null, attempt_count: 1, failure_count: 0, worker_id: null, heartbeat_at: null,
    lock_token: null, lock_expires_at: null, next_attempt_at: null,
    expires_at: null, cancel_requested_at: null, execution_stage: 'completed',
    stage_updated_at: '2026-08-02T00:01:00.000Z', created_at: '2026-08-02T00:00:00.000Z',
    started_at: '2026-08-02T00:00:01.000Z', finished_at: '2026-08-02T00:01:00.000Z',
    updated_at: '2026-08-02T00:01:00.000Z',
  }
}
