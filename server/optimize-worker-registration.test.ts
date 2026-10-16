import { afterEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })))
const getOptimizeWorkerClaimPriority = vi.hoisted(() => vi.fn(() => 0))
const originalAppRole = process.env.APP_ROLE
vi.mock('./storage/postgres', () => ({ query }))
vi.mock('./optimize-job-runner', () => ({
  getOptimizeJobProcessingState: () => ({ workerId: 'worker-runtime-1' }),
}))
vi.mock('./optimize-job-config', () => ({
  getOptimizeWorkerRuntimeConcurrency: () => 4,
  getOptimizeWorkerClaimPriority,
}))

import {
  initializeOptimizeWorkerRegistration,
  OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS,
  OPTIMIZE_WORKER_STALE_AFTER_MS,
  stopOptimizeWorkerRegistration,
  waitForOptimizeWorkerRegistrationIdle,
} from './optimize-worker-registration'

afterEach(async () => {
  stopOptimizeWorkerRegistration()
  await waitForOptimizeWorkerRegistrationIdle()
  query.mockClear()
  getOptimizeWorkerClaimPriority.mockReturnValue(0)
  vi.unstubAllEnvs()
  if (originalAppRole === undefined) delete process.env.APP_ROLE
  else process.env.APP_ROLE = originalAppRole
})

describe('optimize worker runtime registration', () => {
  it('publishes actual capacity and marks the instance draining on shutdown', async () => {
    process.env.APP_ROLE = 'all'
    await initializeOptimizeWorkerRegistration()

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into optimize_worker_registry'),
      expect.arrayContaining([
        'worker-runtime-1',
        4,
        OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS,
        OPTIMIZE_WORKER_STALE_AFTER_MS,
      ]),
    )
    expect(query.mock.calls[0]?.[1]?.[4]).toEqual(expect.arrayContaining(['runtime:local_fallback', 'billing:resident']))

    stopOptimizeWorkerRegistration()
    await waitForOptimizeWorkerRegistrationIdle()
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('set draining = true'),
      ['worker-runtime-1'],
    )
  })

  it('marks a dedicated baseline worker as resident instead of burst', async () => {
    process.env.APP_ROLE = 'worker'

    await initializeOptimizeWorkerRegistration()

    expect(query.mock.calls[0]?.[1]?.[4]).toEqual(expect.arrayContaining(['runtime:ecs_worker', 'billing:resident']))
  })

  it('marks the higher-priority worker as burst', async () => {
    process.env.APP_ROLE = 'worker'
    getOptimizeWorkerClaimPriority.mockReturnValue(10)
    await initializeOptimizeWorkerRegistration()
    expect(query.mock.calls[0]?.[1]?.[4]).toContain('billing:burst')
  })

  it.each([
    ['resident', 10],
    ['burst', 0],
  ] as const)('honors explicit %s billing regardless of claim priority', async (role, priority) => {
    process.env.APP_ROLE = 'worker'
    vi.stubEnv('OPTIMIZE_WORKER_BILLING_ROLE', role)
    getOptimizeWorkerClaimPriority.mockReturnValue(priority)
    await initializeOptimizeWorkerRegistration()
    expect(query.mock.calls[0]?.[1]?.[4]).toContain(`billing:${role}`)
  })

  it('rejects an invalid billing role before publishing capacity', async () => {
    vi.stubEnv('OPTIMIZE_WORKER_BILLING_ROLE', 'unknown')
    await expect(initializeOptimizeWorkerRegistration()).rejects.toThrow('OPTIMIZE_WORKER_BILLING_ROLE must be resident or burst')
    expect(query).not.toHaveBeenCalled()
  })
})
