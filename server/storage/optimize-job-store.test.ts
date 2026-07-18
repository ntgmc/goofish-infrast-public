import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMemoryOptimizeJobStore, OptimizeJobAdmissionError } from './optimize-job-store'

describe('optimization job attempt lifecycle', () => {
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
    await expect(store.completeAttempt(job.id, 1, 'worker-b', 'lock-a', { stale: true })).resolves.toBe(false)
    await expect(store.completeAttempt(job.id, 1, 'worker-a', 'lock-a', { ok: true })).resolves.toBe(true)
    await expect(store.getJob(job.id)).resolves.toMatchObject({ status: 'succeeded', result_json: { ok: true } })
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
  it('counts a generated schedule once when upgrade suggestions run as a continuation', async () => {
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `license:${randomUUID()}`

    for (let index = 0; index < 12; index += 1) {
      const schedule = await store.admitJob(admissionInput(ownerKey, 'account_profile'))
      store.records.get(schedule.job.id)!.status = 'succeeded'

      const suggestions = await store.admitJob(admissionInput(ownerKey, 'optimize_suggestions'))
      store.records.get(suggestions.job.id)!.status = 'succeeded'
    }

    await expect(store.admitJob(admissionInput(ownerKey, 'account_profile'))).rejects.toEqual(
      new OptimizeJobAdmissionError(
        'submission_rate_exceeded',
        429,
        '当前账号的优化提交次数已达小时上限。请1小时后再试。',
      ),
    )
  })

  it('keeps an independent hourly limit for upgrade suggestion continuations', async () => {
    const store = createMemoryOptimizeJobStore()
    const ownerKey = `license:${randomUUID()}`

    for (let index = 0; index < 12; index += 1) {
      const suggestions = await store.admitJob(admissionInput(ownerKey, 'optimize_suggestions'))
      store.records.get(suggestions.job.id)!.status = 'succeeded'
    }

    await expect(store.admitJob(admissionInput(ownerKey, 'optimize_suggestions'))).rejects.toMatchObject({
      code: 'submission_rate_exceeded',
      status: 429,
      message: '当前账号的优化提交次数已达小时上限。请1小时后再试。',
    })
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

function admissionInput(ownerKey: string, source: string) {
  return {
    ...input(),
    owner_key: ownerKey,
    source,
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
