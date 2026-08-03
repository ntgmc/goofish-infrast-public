import { afterEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })))
vi.mock('./storage/postgres', () => ({ query }))
vi.mock('./optimize-job-runner', () => ({
  getOptimizeJobProcessingState: () => ({ workerId: 'worker-runtime-1' }),
}))
vi.mock('./optimize-job-config', () => ({ getOptimizeWorkerConcurrency: () => 4 }))

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
})

describe('optimize worker runtime registration', () => {
  it('publishes actual capacity and marks the instance draining on shutdown', async () => {
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

    stopOptimizeWorkerRegistration()
    await waitForOptimizeWorkerRegistrationIdle()
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('set draining = true'),
      ['worker-runtime-1'],
    )
  })
})
