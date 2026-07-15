import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  initializeOptimizeJobProcessing,
  kickOptimizeJobProcessing,
  registerOptimizeJobExecutor,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import { createMemoryOptimizeJobStore } from './storage/optimize-job-store'

afterAll(async () => {
  await shutdownOptimizeJobProcessing(1_000)
  globalThis.__maaOptimizeJobStoreForTesting = undefined
})

describe('optimization dispatcher startup recovery', () => {
  it('recovers an expired attempt and consumes queued jobs without an HTTP kick', async () => {
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
    await waitFor(async () => (await store.getJob(job.id))?.status === 'failed')

    expect(Date.now() - startedAt).toBeLessThan(750)
    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'failed',
      failure_count: 1,
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
    source: 'license_file',
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
