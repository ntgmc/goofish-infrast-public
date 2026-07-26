import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  getOptimizeJobProcessingState,
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import { shutdownOptimizeQueueMaintenance } from './optimize-queue-maintenance'
import { requestOptimizeJobProcessing } from './optimize-job-signals'
import {
  OPTIMIZER_PORT_VERSION,
  registerOptimizerPort,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import { createMemoryOptimizeJobStore } from './storage/optimize-job-store'

let executeSchedule: (context: OptimizeExecutionContext) => Promise<unknown> = async (context) => ({
  completedJobId: context.jobId,
})
let unregisterOptimizerPort: (() => void) | null = null

afterAll(async () => {
  await shutdownOptimizeJobProcessing(1_000)
  shutdownOptimizeQueueMaintenance()
  unregisterOptimizerPort?.()
  globalThis.__maaOptimizeJobStoreForTesting = undefined
  delete process.env.APP_ROLE
})

describe('optimization dispatcher startup recovery', () => {
  it('fails before initialization when no optimizer implementation is registered', async () => {
    await expect(initializeOptimizeJobProcessing()).rejects.toThrow('OptimizerPort is not registered')
    expect(getOptimizeJobProcessingState()).toMatchObject({ initialized: false, accepting: false })
  })

  it('recovers an expired attempt and consumes queued jobs without an HTTP kick', async () => {
    process.env.OPTIMIZE_RETRY_BASE_MS = '100'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    unregisterOptimizerPort = registerOptimizerPort(fakePort())
    executeSchedule = async (context) => ({ completedJobId: context.jobId })

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

  it('enforces the hard timeout for inline execution', async () => {
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '25'
    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '2'
    executeSchedule = async () => new Promise<never>(() => undefined)
    const job = await store.createJob(input())

    const startedAt = Date.now()
    try {
      requestOptimizeJobProcessing()
      await waitFor(async () => (await store.getJob(job.id))?.status === 'dead_lettered')

      expect(Date.now() - startedAt).toBeLessThan(750)
      await expect(store.getJob(job.id)).resolves.toMatchObject({
        status: 'dead_lettered',
        attempt_count: 1,
        failure_count: 1,
        failure_kind: 'timed_out',
        public_error_code: 'execution_retries_exhausted',
      })
    } finally {
      executeSchedule = async (context) => ({ completedJobId: context.jobId })
      delete process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS
      delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
    }
  })

  it('terminates a CPU-blocked worker at the parent wall-clock deadline', async () => {
    const store = globalThis.__maaOptimizeJobStoreForTesting!
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-busy-worker.mjs')
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '25'
    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '1'
    const job = await store.createJob({ ...input(), payload_json: { busyMs: 1_000 } })

    const startedAt = Date.now()
    requestOptimizeJobProcessing()
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

  it('uses only the remaining calculation budget after a retry', async () => {
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-busy-worker.mjs')
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '1000'
    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '1'
    const job = await store.createJob({ ...input(), payload_json: { busyMs: 2_000 } })
    store.records.get(job.id)!.started_at = new Date(Date.now() - 900).toISOString()

    const startedAt = Date.now()
    try {
      requestOptimizeJobProcessing()
      await waitFor(async () => (await store.getJob(job.id))?.status === 'dead_lettered')

      expect(Date.now() - startedAt).toBeLessThan(750)
      await expect(store.getJob(job.id)).resolves.toMatchObject({
        status: 'dead_lettered',
        attempt_count: 1,
        failure_kind: 'timed_out',
      })
    } finally {
      delete process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING
      delete process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING
      delete process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS
      delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
    }
  })

  it('persists worker-thread progress messages before completing the attempt', async () => {
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-progress-worker.mjs')
    const job = await store.createJob(input())

    requestOptimizeJobProcessing()
    await waitFor(async () => (await store.getJob(job.id))?.execution_stage === 'simulating_upgrades')
    await waitFor(async () => (await store.getJob(job.id))?.status === 'succeeded')

    await expect(store.getJob(job.id)).resolves.toMatchObject({
      status: 'succeeded',
      execution_stage: 'completed',
      result_json: { ok: true },
    })

    delete process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING
    delete process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING
  })

  it('terminates and requeues unfinished work after the shutdown grace period', async () => {
    const store = globalThis.__maaOptimizeJobStoreForTesting!
    process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING = '1'
    process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING = resolve('server/test-fixtures/optimize-busy-worker.mjs')
    process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS = '1000'
    const job = await store.createJob({ ...input(), payload_json: { busyMs: 1_000 } })

    requestOptimizeJobProcessing()
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
    payload_json: { version: 3 },
  }
}

function fakePort(): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: async (_payload, context) => executeSchedule(context) as Promise<never>,
    executeScenarioComparison: async () => ({} as never),
    executeReorderCheck: async () => ({} as never),
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
