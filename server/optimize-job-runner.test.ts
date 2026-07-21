import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  initializeOptimizeJobProcessing,
  initializeOptimizeQueueMaintenance,
  kickOptimizeJobProcessing,
  registerOptimizeJobExecutor,
  shutdownOptimizeJobProcessing,
  shutdownOptimizeQueueMaintenance,
} from './optimize-job-runner'
import { createMemoryOptimizeJobStore } from './storage/optimize-job-store'

afterAll(async () => {
  await shutdownOptimizeJobProcessing(1_000)
  shutdownOptimizeQueueMaintenance()
  globalThis.__maaOptimizeJobStoreForTesting = undefined
  delete process.env.APP_ROLE
})

describe('optimization dispatcher startup recovery', () => {
  it('maintains queue state without consuming jobs in the API role', async () => {
    process.env.APP_ROLE = 'api'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    registerOptimizeJobExecutor(async (job) => ({ completedJobId: job.id }))

    const expired = await store.createJob(input())
    const queued = await store.createJob(input())
    await store.claimNextJob(
      'old-worker',
      'old-lock',
      new Date(Date.now() - 1_000).toISOString(),
      2,
    )

    await initializeOptimizeQueueMaintenance()
    kickOptimizeJobProcessing()
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))

    await expect(store.getJob(expired.id)).resolves.toMatchObject({ status: 'queued' })
    await expect(store.getJob(queued.id)).resolves.toMatchObject({ status: 'queued' })
    shutdownOptimizeQueueMaintenance()
    delete process.env.APP_ROLE
  })

  it('recovers an expired attempt and consumes queued jobs without an HTTP kick', async () => {
    process.env.OPTIMIZE_RETRY_BASE_MS = '100'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    registerOptimizeJobExecutor(async (job) => ({ completedJobId: job.id }))

    const expired = await store.createJob(input())
    const queued = await store.createJob(input())
    await store.claimNextJob(
      'old-worker',
      'old-lock',
      new Date(Date.now() - 1_000).toISOString(),
      2,
    )

    await initializeOptimizeJobProcessing()

    await waitFor(async () => (await store.getJob(expired.id))?.status === 'succeeded')

    await expect(store.getJob(expired.id)).resolves.toMatchObject({
      status: 'succeeded',
      attempt_count: 2,
      failure_count: 1,
      result_json: { completedJobId: expired.id },
    })
    await expect(store.getJob(queued.id)).resolves.toMatchObject({
      status: 'succeeded',
      attempt_count: 1,
      failure_count: 0,
      result_json: { completedJobId: queued.id },
    })
    delete process.env.OPTIMIZE_RETRY_BASE_MS
  })

  it('terminates a CPU-blocked worker at the parent wall-clock deadline', async () => {
    const store = globalThis.__maaOptimizeJobStoreForTesting!
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-busy-worker.mjs')
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '25'
    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '1'
    const job = await store.createJob({ ...input(), payload_json: { busyMs: 1_000 } })

    const startedAt = Date.now()
    kickOptimizeJobProcessing()
    await waitFor(async () => (await store.getJob(job.id))?.status === 'dead_lettered')

    expect(Date.now() - startedAt).toBeLessThan(750)
    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'dead_lettered',
      failure_count: 1,
      public_error_code: 'execution_retries_exhausted',
    })

    delete process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING
    delete process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING
    delete process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS
    delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
  })

  it('terminates and requeues unfinished work after the shutdown grace period', async () => {
    const store = globalThis.__maaOptimizeJobStoreForTesting!
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-busy-worker.mjs')
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '1000'
    const job = await store.createJob({ ...input(), payload_json: { busyMs: 1_000 } })

    kickOptimizeJobProcessing()
    await waitFor(async () => (await store.getJob(job.id))?.status === 'running')
    await shutdownOptimizeJobProcessing(25)

    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'queued',
      failure_count: 0,
      worker_id: null,
      lock_token: null,
    })

    delete process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING
    delete process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING
    delete process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS
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

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error('Timed out waiting for optimization job state.')
}
