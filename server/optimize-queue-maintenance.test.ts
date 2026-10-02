import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initializeOptimizeQueueMaintenance,
  isOptimizeQueueMaintenanceInitialized,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import { registerOptimizeJobSignalHandlers } from './optimize-job-signals'
import { createMemoryOptimizeJobStore } from './storage/optimize-job-store'

const originalAppRole = process.env.APP_ROLE
const originalMaxAttempts = process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
let unregisterSignals: (() => void) | null = null

afterEach(() => {
  shutdownOptimizeQueueMaintenance()
  unregisterSignals?.()
  unregisterSignals = null
  globalThis.__maaOptimizeJobStoreForTesting = undefined
  restoreEnvironment('APP_ROLE', originalAppRole)
  restoreEnvironment('OPTIMIZE_JOB_MAX_ATTEMPTS', originalMaxAttempts)
})

describe('optimization queue maintenance', () => {
  it('recovers expired attempts without consuming queued work in the API role', async () => {
    process.env.APP_ROLE = 'api'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    const processingRequested = vi.fn()
    unregisterSignals = registerOptimizeJobSignalHandlers({
      onProcessingRequested: processingRequested,
      onCancellationRequested: vi.fn(),
    })

    const expired = await store.createJob(input('00000000-0000-4000-8000-000000000001'))
    const queued = await store.createJob(input('ffffffff-ffff-4fff-bfff-ffffffffffff'))
    await store.claimNextJob(
      'old-worker',
      'old-lock',
      new Date(Date.now() - 1_000).toISOString(),
      2,
    )

    await initializeOptimizeQueueMaintenance()

    await expect(store.getJob(expired.id)).resolves.toMatchObject({ status: 'queued', failure_count: 1 })
    await expect(store.getJob(queued.id)).resolves.toMatchObject({ status: 'queued', attempt_count: 0 })
    expect(processingRequested).toHaveBeenCalledOnce()
    expect(isOptimizeQueueMaintenanceInitialized()).toBe(true)
  })

  it('uses the shared maximum attempt count when recovering an expired lease', async () => {
    process.env.APP_ROLE = 'api'
    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '1'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    const expired = await store.createJob(input())
    await store.claimNextJob(
      'old-worker',
      'old-lock',
      new Date(Date.now() - 1_000).toISOString(),
      1,
    )

    await expect(initializeOptimizeQueueMaintenance()).resolves.toBeUndefined()

    await expect(store.getJob(expired.id)).resolves.toMatchObject({
      status: 'dead_lettered',
      failure_count: 1,
      public_error_code: 'execution_retries_exhausted',
    })
  })

  it('retains two-day-old records and removes terminal records older than seven days', async () => {
    process.env.APP_ROLE = 'api'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    const recent = await store.createJob(input())
    const old = await store.createJob(input())
    const recentTime = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString()
    Object.assign(store.records.get(recent.id)!, { status: 'succeeded', finished_at: recentTime, updated_at: recentTime })
    Object.assign(store.records.get(old.id)!, { status: 'dead_lettered', finished_at: oldTime, updated_at: oldTime })
    await initializeOptimizeQueueMaintenance()
    expect(await store.getJob(recent.id)).not.toBeNull()
    expect(await store.getJob(old.id)).toBeNull()
  })

  it('initializes once, tolerates missing signal handlers, and resets on shutdown', async () => {
    process.env.APP_ROLE = 'api'
    const store = createMemoryOptimizeJobStore()
    globalThis.__maaOptimizeJobStoreForTesting = store
    const recoverExpiredAttempts = vi.spyOn(store, 'recoverExpiredAttempts')

    await initializeOptimizeQueueMaintenance()
    await initializeOptimizeQueueMaintenance()

    expect(recoverExpiredAttempts).toHaveBeenCalledOnce()
    expect(isOptimizeQueueMaintenanceInitialized()).toBe(true)

    shutdownOptimizeQueueMaintenance()
    expect(isOptimizeQueueMaintenanceInitialized()).toBe(false)
  })
})

function input(id = randomUUID()) {
  return {
    id,
    priority: 10,
    owner_key: `license:${randomUUID()}`,
    permission: 'growth',
    source: 'account_profile',
    payload_json: { test: true },
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
