import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryOptimizeJobStore, OptimizeJobAdmissionError } from './optimize-job-store'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('optimization job attempt lifecycle', () => {
  it('upgrades the legacy 30-minute environment value to 24 hours', async () => {
    vi.stubEnv('OPTIMIZE_QUEUE_MAX_AGE_MS', String(30 * 60_000))
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())

    expect(Date.parse(job.expires_at!) - Date.parse(job.created_at)).toBe(24 * 60 * 60_000)
  })

  it('keeps a never-started job queued within the 24-hour window', async () => {
    const store = createMemoryOptimizeJobStore()
    const createdAt = new Date(Date.now() - 23 * 60 * 60_000).toISOString()
    const job = await store.createJob({ ...input(), created_at: createdAt })

    await expect(store.expireQueuedJobs(new Date().toISOString())).resolves.toBe(0)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ status: 'queued' })
  })

  it('clears the 24-hour queue expiry as soon as execution begins', async () => {
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())
    expect(Date.parse(job.expires_at!) - Date.parse(job.created_at)).toBe(24 * 60 * 60_000)

    const claimed = await store.claimNextJob('worker-a', 'lock-a', future(), 2)
    expect(claimed).toMatchObject({ id: job.id, status: 'running', expires_at: null })

    await expect(store.expireQueuedJobs(new Date(Date.now() + 48 * 60 * 60_000).toISOString())).resolves.toBe(0)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ status: 'running', expires_at: null })
  })

  it('fences heartbeats and completes only the current attempt owner', async () => {
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())
    const claimed = await store.claimNextJob('worker-a', 'lock-a', future(), 2)

    expect(claimed).toMatchObject({
      id: job.id,
      status: 'running',
      attempt_count: 1,
      failure_count: 0,
      worker_id: 'worker-a',
    })
    await expect(store.heartbeatAttempt(job.id, 1, 'worker-b', 'lock-a', future())).resolves.toBe(false)
    await expect(store.heartbeatAttempt(job.id, 1, 'worker-a', 'lock-a', future())).resolves.toBe(true)
    await expect(store.updateAttemptStage(job.id, 1, 'worker-b', 'lock-a', 'simulating_upgrades')).resolves.toBe(false)
    await expect(store.updateAttemptStage(job.id, 1, 'worker-a', 'lock-a', 'simulating_upgrades')).resolves.toBe(true)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ execution_stage: 'simulating_upgrades' })
    await expect(store.completeAttempt(job.id, 1, 'worker-b', 'lock-a', { stale: true })).resolves.toBe(false)
    await expect(store.completeAttempt(job.id, 1, 'worker-a', 'lock-a', { ok: true })).resolves.toBe(true)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ status: 'succeeded', execution_stage: 'completed', result_json: { ok: true } })
  })

  it('returns an interrupted deployment attempt to queued without consuming failure budget', async () => {
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())
    const claimed = await store.claimNextJob('worker-a', 'lock-a', future(), 2)

    await expect(store.releaseInterruptedAttempt(job.id, claimed!.attempt_count, 'worker-a', 'lock-a')).resolves.toBe(true)
    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'queued',
      attempt_count: 1,
      failure_count: 0,
      worker_id: null,
      lock_token: null,
    })

    const retried = await store.claimNextJob('worker-b', 'lock-b', future(), 2)
    expect(retried).toMatchObject({ status: 'running', attempt_count: 2, failure_count: 0 })
  })

  it('recovers expired attempts and dead-letters after the configured failure budget', async () => {
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())
    await store.claimNextJob('worker-a', 'lock-a', past(), 2)

    await expect(store.recoverExpiredAttempts(new Date().toISOString(), 2)).resolves.toBe(1)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ status: 'queued', failure_count: 1 })
    await expect(store.claimNextJob('worker-b', 'lock-b', past(), 2)).resolves.toBeNull()

    store.records.get(job.id)!.next_attempt_at = past()
    await store.claimNextJob('worker-b', 'lock-b', past(), 2)
    await expect(store.recoverExpiredAttempts(new Date().toISOString(), 2)).resolves.toBe(1)
    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'dead_lettered',
      failure_count: 2,
      error_message: '任务执行租约已过期，请重试。',
      public_error_code: 'execution_retries_exhausted',
    })
  })

  it('dead-letters a running job whose calculation budget expires despite a live lease', async () => {
    const store = createMemoryOptimizeJobStore()
    const job = await store.createJob(input())
    const claimed = await store.claimNextJob('worker-a', 'lock-a', future(), 2)
    const record = store.records.get(job.id)!
    record.started_at = new Date(Date.now() - 10 * 60_000 - 1).toISOString()
    record.lock_expires_at = future()

    await expect(store.recoverExpiredAttempts(new Date().toISOString(), 2)).resolves.toBe(1)
    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'dead_lettered',
      attempt_count: claimed!.attempt_count,
      failure_count: 1,
      failure_kind: 'timed_out',
      public_error_code: 'execution_retries_exhausted',
    })
  })

  it('retries worker failures but treats application failures as terminal', async () => {
    const retryStore = createMemoryOptimizeJobStore()
    const retryJob = await retryStore.createJob(input())
    const retryAttempt = await retryStore.claimNextJob('worker-a', 'lock-a', future(), 2)
    await expect(retryStore.retryFailedAttempt(
      retryJob.id,
      retryAttempt!.attempt_count,
      'worker-a',
      'lock-a',
      'worker_crash',
      'crashed',
      2,
    )).resolves.toBe('queued')

    const terminalStore = createMemoryOptimizeJobStore()
    const terminalJob = await terminalStore.createJob(input())
    const terminalAttempt = await terminalStore.claimNextJob('worker-a', 'lock-a', future(), 2)
    await expect(terminalStore.failAttempt(
      terminalJob.id,
      terminalAttempt!.attempt_count,
      'worker-a',
      'lock-a',
      'invalid input',
    )).resolves.toBe(true)
    await expect(terminalStore.getJob(terminalJob.id)).resolves.toMatchObject({ status: 'failed', failure_count: 1 })
  })
})

describe('optimization job submission admission', () => {
  it('reserves reorder quota once for an idempotent job and releases it on cancellation', async () => {
    const store = createMemoryOptimizeJobStore()
    const profileId = randomUUID()
    const firstInput = reorderAdmissionInput(profileId)
    const first = await store.admitJob(firstInput)

    await expect(store.admitJob(firstInput)).resolves.toMatchObject({
      replayed: true,
      job: { id: first.job.id },
    })
    await expect(store.admitJob(reorderAdmissionInput(profileId))).rejects.toMatchObject({
      code: 'reorder_check_quota_exceeded',
      status: 429,
    })

    await store.requestCancel(first.job.id)
    await expect(store.admitJob(reorderAdmissionInput(profileId))).resolves.toMatchObject({ replayed: false })
  })

  it('consumes reorder quota on success and releases it on application failure', async () => {
    const profileId = randomUUID()
    const succeededStore = createMemoryOptimizeJobStore()
    const succeeded = await succeededStore.admitJob(reorderAdmissionInput(profileId))
    const succeededAttempt = await succeededStore.claimNextJob('worker-a', 'lock-a', future(), 2)
    await succeededStore.completeAttempt(succeeded.job.id, succeededAttempt!.attempt_count, 'worker-a', 'lock-a', { recommendation: 'no_need' })
    await expect(succeededStore.admitJob(reorderAdmissionInput(profileId))).rejects.toMatchObject({
      code: 'reorder_check_quota_exceeded',
    })

    const failedStore = createMemoryOptimizeJobStore()
    const failed = await failedStore.admitJob(reorderAdmissionInput(profileId))
    const failedAttempt = await failedStore.claimNextJob('worker-b', 'lock-b', future(), 2)
    await failedStore.failAttempt(failed.job.id, failedAttempt!.attempt_count, 'worker-b', 'lock-b', 'invalid input')
    await expect(failedStore.admitJob(reorderAdmissionInput(profileId))).resolves.toMatchObject({ replayed: false })
  })

  it('rejects a job before its estimated wait reaches the queue age limit', async () => {
    vi.stubEnv('OPTIMIZE_QUEUE_MAX_AGE_MS', '60000')
    vi.stubEnv('OPTIMIZE_GLOBAL_WORKER_CONCURRENCY', '2')
    const store = createMemoryOptimizeJobStore()

    await store.admitJob(admissionInput(`license:${randomUUID()}`, 'account_profile', 60_000))
    await store.admitJob(admissionInput(`license:${randomUUID()}`, 'account_profile', 60_000))

    await expect(
      store.admitJob(admissionInput(`license:${randomUUID()}`, 'account_profile', 5_000)),
    ).rejects.toEqual(new OptimizeJobAdmissionError(
      'queue_wait_capacity_exceeded',
      429,
      '任务等待时间超过队列上限，请稍后重试。',
    ))
  })

  it('accounts for per-owner serialization when estimating queue wait', async () => {
    vi.stubEnv('OPTIMIZE_QUEUE_MAX_AGE_MS', '60000')
    vi.stubEnv('OPTIMIZE_GLOBAL_WORKER_CONCURRENCY', '2')
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `license:${randomUUID()}`

    await store.admitJob(admissionInput(ownerKey, 'account_profile', 40_000))
    await store.admitJob(admissionInput(ownerKey, 'account_profile', 40_000))

    await expect(
      store.admitJob(admissionInput(ownerKey, 'account_profile', 5_000)),
    ).rejects.toMatchObject({
      code: 'queue_wait_capacity_exceeded',
      status: 429,
      message: '任务等待时间超过队列上限，请稍后重试。',
    })
  })

  it('reserves hard-timeout capacity for an overdue running job', async () => {
    vi.stubEnv('OPTIMIZE_QUEUE_MAX_AGE_MS', '60000')
    vi.stubEnv('OPTIMIZE_GLOBAL_WORKER_CONCURRENCY', '1')
    vi.stubEnv('OPTIMIZE_JOB_HARD_TIMEOUT_MS', '120000')
    const store = createMemoryOptimizeJobStore()
    const running = await store.createJob({
      ...input(),
      payload_json: { estimate: { estimated_duration_ms: 10_000 } },
    })
    const runningRecord = store.records.get(running.id)!
    runningRecord.status = 'running'
    runningRecord.started_at = new Date(Date.now() - 20_000).toISOString()

    await expect(
      store.admitJob(admissionInput(`license:${randomUUID()}`, 'account_profile', 5_000)),
    ).rejects.toMatchObject({ code: 'queue_wait_capacity_exceeded', status: 429 })
  })

  it('counts each merged schedule and suggestion request as one submission', async () => {
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `license:${randomUUID()}`

    for (let index = 0; index < 12; index += 1) {
      const schedule = await store.admitJob(admissionInput(ownerKey, 'account_profile'))
      store.records.get(schedule.job.id)!.status = 'succeeded'
    }

    await expect(store.admitJob(admissionInput(ownerKey, 'account_profile'))).rejects.toEqual(
      new OptimizeJobAdmissionError(
        'submission_rate_exceeded',
        429,
        '当前账号的优化提交次数已达小时上限。请1小时后再试。',
      ),
    )
  })
})

function input() {
  return {
    id: randomUUID(),
    priority: 10,
    owner_key: `license:${randomUUID()}`,
    permission: 'growth',
    source: 'account_profile',
    payload_json: { test: true },
  }
}

function admissionInput(ownerKey: string, source: string, estimatedDurationMs?: number) {
  return {
    ...input(),
    owner_key: ownerKey,
    source,
    payload_json: {
      test: true,
      ...(estimatedDurationMs ? { estimate: { estimated_duration_ms: estimatedDurationMs } } : {}),
    },
    idempotency_key: randomUUID(),
    request_hash: randomUUID(),
  }
}

function reorderAdmissionInput(profileId: string) {
  return {
    ...admissionInput(`reorder-job:${randomUUID()}`, 'reorder_check'),
    profile_id: profileId,
    payload_json: { version: 3, kind: 'reorder_check' },
    reorderCheckQuota: {
      profileId,
      windowKey: '2026-07',
      limit: 1,
    },
  }
}

function future(): string {
  return new Date(Date.now() + 60_000).toISOString()
}

function past(): string {
  return new Date(Date.now() - 1_000).toISOString()
}
