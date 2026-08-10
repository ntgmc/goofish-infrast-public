import { afterEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })))
const originalAppRole = process.env.APP_ROLE
vi.mock('./storage/postgres', () => ({ query }))
vi.mock('./optimize-job-runner', () => ({
  getOptimizeJobProcessingState: () => ({ workerId: 'worker-runtime-1' }),
}))
vi.mock('./optimize-job-config', () => ({ getOptimizeWorkerRuntimeConcurrency: () => 4 }))

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
    expect(query.mock.calls[0]?.[1]?.[4]).toContain('runtime:local_fallback')

    stopOptimizeWorkerRegistration()
    await waitForOptimizeWorkerRegistrationIdle()
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('set draining = true'),
      ['worker-runtime-1'],
    )
  })

  it('marks a dedicated worker as a billable ECS runtime', async () => {
    process.env.APP_ROLE = 'worker'

    await initializeOptimizeWorkerRegistration()

    expect(query.mock.calls[0]?.[1]?.[4]).toContain('runtime:ecs_worker')
  })
})
