import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryOptimizeJobStore, OptimizeJobAdmissionError, type MemoryWorkerRegistryEntry } from './optimize-job-store'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('optimization job attempt lifecycle', () => {
  it('replays a legacy raw-body idempotency hash after canonical hashing is deployed', async () => {
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `profile:${randomUUID()}`
    const firstInput = admissionInput(ownerKey, 'account_profile')
    const admitted = await store.admitJob(firstInput)
    const canonicalHash = randomUUID()

    await expect(store.admitJob({
      ...firstInput,
      id: randomUUID(),
      request_hash: canonicalHash,
      legacy_request_hash: firstInput.request_hash,
    })).resolves.toMatchObject({ replayed: true, job: { id: admitted.job.id } })
    await expect(store.findIdempotentJob(
      ownerKey,
      firstInput.idempotency_key,
      canonicalHash,
      firstInput.request_hash,
    )).resolves.toMatchObject({ id: admitted.job.id })
    await expect(store.findIdempotentJob(
      ownerKey,
      firstInput.idempotency_key,
      canonicalHash,
      'different-legacy-hash',
    )).rejects.toMatchObject({ code: 'idempotency_conflict' })
  })

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

  it('replaces only the youngest running idle-class attempt with waiting paid work', async () => {
    const store = createMemoryOptimizeJobStore()
    const olderFree = await store.createJob({ ...input(), priority: 0, source: 'free_preview', created_at: '2026-08-29T00:00:00.000Z' })
    const newerFree = await store.createJob({ ...input(), priority: 0, source: 'free_preview', created_at: '2026-08-29T00:00:01.000Z' })
    const olderClaim = await store.claimNextJob('worker-a', 'free-lock-older', future(), 2, 2)
    const newerClaim = await store.claimNextJob('worker-a', 'free-lock-newer', future(), 2, 2)
    expect(olderClaim?.id).toBe(olderFree.id)
    expect(newerClaim?.id).toBe(newerFree.id)
    store.records.get(olderFree.id)!.started_at = '2026-08-29T00:00:00.000Z'
    store.records.get(newerFree.id)!.started_at = '2026-08-29T00:00:01.000Z'
    const paid = await store.createJob({ ...input(), priority: 10, source: 'account_profile' })

    const preemption = await store.preemptFreeJobForPaid({
      workerId: 'worker-a',
      candidateJobIds: [olderFree.id, newerFree.id],
      lockToken: 'paid-lock',
      lockExpiresAt: future(),
      maxFailures: 2,
      maxGlobalRunning: 2,
      claimPriority: 0,
      graceMs: 0,
    })

    expect(preemption).toMatchObject({ interruptedJobId: newerFree.id, job: { id: paid.id, status: 'running' } })
    await expect(store.getJob(olderFree.id)).resolves.toMatchObject({ status: 'running' })
    await expect(store.getJob(newerFree.id)).resolves.toMatchObject({
      status: 'queued',
      failure_count: 0,
      started_at: null,
    })
  })

  it('starts the paid preemption grace period when a retried job becomes runnable', async () => {
    const store = createMemoryOptimizeJobStore()
    const free = await store.createJob({ ...input(), priority: 0, source: 'free_preview' })
    await store.claimNextJob('worker-a', 'free-lock', future(), 2, 1)
    const paid = await store.createJob({ ...input(), priority: 10, source: 'account_profile' })
    store.records.get(paid.id)!.created_at = new Date(Date.now() - 60_000).toISOString()
    store.records.get(paid.id)!.next_attempt_at = new Date().toISOString()
    const preemptionInput = {
      workerId: 'worker-a',
      candidateJobIds: [free.id],
      lockToken: 'paid-lock',
      lockExpiresAt: future(),
      maxFailures: 2,
      maxGlobalRunning: 1,
      claimPriority: 0,
      graceMs: 15_000,
    }

    await expect(store.preemptFreeJobForPaid(preemptionInput)).resolves.toBeNull()
    store.records.get(paid.id)!.next_attempt_at = new Date(Date.now() - 16_000).toISOString()
    await expect(store.preemptFreeJobForPaid(preemptionInput)).resolves.toMatchObject({
      interruptedJobId: free.id,
      job: { id: paid.id, status: 'running' },
    })
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
    record.started_at = new Date(Date.now() - 20 * 60_000 - 1).toISOString()
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
    await expect(terminalStore.getJob(terminalJob.id)).resolves.toMatchObject({
      status: 'failed',
      failure_count: 1,
      error_message: '优化任务失败，请检查输入后重试。',
      public_error_code: 'application_error',
    })
  })

  it('uses the id tiebreaker consistently for queue rank, claiming, and composite pagination', async () => {
    const store = createMemoryOptimizeJobStore()
    const createdAt = '2026-07-31T00:00:00.000Z'
    for (const id of ['job-a', 'job-b', 'job-c']) {
      await store.createJob({
        ...input(),
        id,
        profile_id: 'profile-1',
        created_at: createdAt,
      })
    }

    const firstPage = await store.listJobsByProfile('profile-1', 2)
    expect(firstPage.map((entry) => [entry.job.id, entry.queuePosition])).toEqual([
      ['job-c', 3],
      ['job-b', 2],
    ])
    const secondPage = await store.listJobsByProfile('profile-1', 2, { createdAt, id: 'job-b' })
    expect(secondPage.map((entry) => entry.job.id)).toEqual(['job-a'])
    await expect(store.claimNextJob('worker-a', 'lock-a', future(), 2)).resolves.toMatchObject({ id: 'job-a' })
  })
})

describe('optimization job submission admission', () => {
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

  it('limits free previews to two submissions in a rolling six-hour window', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-08-29T00:00:00.000Z')
    vi.setSystemTime(startedAt)
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `license:${randomUUID()}`

    const first = await store.admitJob(admissionInput(ownerKey, 'free_preview'))
    store.records.get(first.job.id)!.status = 'succeeded'
    vi.setSystemTime(new Date(startedAt.getTime() + 2 * 60 * 60_000))
    const second = await store.admitJob(admissionInput(ownerKey, 'free_preview'))
    store.records.get(second.job.id)!.status = 'succeeded'
    vi.setSystemTime(new Date(startedAt.getTime() + 5 * 60 * 60_000))

    await expect(store.admitJob(admissionInput(ownerKey, 'free_preview'))).rejects.toEqual(
      new OptimizeJobAdmissionError(
        'submission_rate_exceeded',
        429,
        '免费预览每 6 小时最多提交 2 次排班，请稍后再试。',
      ),
    )

    vi.setSystemTime(new Date(startedAt.getTime() + 6 * 60 * 60_000 + 1))
    await expect(store.admitJob(admissionInput(ownerKey, 'free_preview'))).resolves.toMatchObject({ replayed: false })
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

function future(): string {
  return new Date(Date.now() + 60_000).toISOString()
}

function past(): string {
  return new Date(Date.now() - 1_000).toISOString()
}

describe('worker claim priority', () => {
  it('keeps a lower-priority worker from claiming while a live higher-priority worker exists', async () => {
    const registry = new Map<string, MemoryWorkerRegistryEntry>([
      ['hangzhou', { priority: 10 }],
      ['resident', { priority: 0 }],
    ])
    const store = createMemoryOptimizeJobStore(registry)
    await store.createJob(input())
    await expect(
      store.claimNextJob('resident', 'lock-resident', future(), 2, Number.MAX_SAFE_INTEGER, 0),
    ).resolves.toBeNull()
    await expect(
      store.claimNextJob('hangzhou', 'lock-hangzhou', future(), 2, Number.MAX_SAFE_INTEGER, 10),
    ).resolves.toMatchObject({ status: 'running' })
  })

  it('lets the lower-priority worker claim once the higher-priority worker drains or goes stale', async () => {
    const draining = new Map<string, MemoryWorkerRegistryEntry>([
      ['hangzhou', { priority: 10, draining: true }],
      ['resident', { priority: 0 }],
    ])
    const drainingStore = createMemoryOptimizeJobStore(draining)
    await drainingStore.createJob(input())
    await expect(
      drainingStore.claimNextJob(
        'resident',
        'lock-resident',
        future(),
        2,
        Number.MAX_SAFE_INTEGER,
        0,
      ),
    ).resolves.toMatchObject({ status: 'running' })

    const stale = new Map<string, MemoryWorkerRegistryEntry>([
      ['hangzhou', { priority: 10, stale: true }],
      ['resident', { priority: 0 }],
    ])
    const staleStore = createMemoryOptimizeJobStore(stale)
    await staleStore.createJob(input())
    await expect(
      staleStore.claimNextJob(
        'resident',
        'lock-resident',
        future(),
        2,
        Number.MAX_SAFE_INTEGER,
        0,
      ),
    ).resolves.toMatchObject({ status: 'running' })
  })

  it('does not block a worker when its own priority matches the live peer', async () => {
    const registry = new Map<string, MemoryWorkerRegistryEntry>([
      ['hangzhou', { priority: 10 }],
      ['resident', { priority: 10 }],
    ])
    const store = createMemoryOptimizeJobStore(registry)
    await store.createJob(input())
    await expect(
      store.claimNextJob('resident', 'lock-resident', future(), 2, Number.MAX_SAFE_INTEGER, 10),
    ).resolves.toMatchObject({ status: 'running' })
  })
})
