import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  hasDatabaseUrl: vi.fn(),
  advisoryLock: vi.fn(),
  snapshot: vi.fn(),
  record: vi.fn(),
  prune: vi.fn(),
}))

vi.mock('./lifecycle', () => ({ isServiceReady: mocks.ready }))
vi.mock('./storage/postgres', () => ({ hasDatabaseUrl: mocks.hasDatabaseUrl, withPostgresAdvisoryLock: mocks.advisoryLock }))
vi.mock('./storage/optimize-job-store', () => ({ getAdminOptimizationQueueSnapshot: mocks.snapshot }))
vi.mock('./storage/service-status-store', () => ({ recordServiceStatusSample: mocks.record, pruneServiceStatusHistory: mocks.prune }))

import { runServiceStatusSampling } from './service-status-history'

describe('service status history sampler', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ready.mockReturnValue(true)
    mocks.hasDatabaseUrl.mockReturnValue(true)
    mocks.advisoryLock.mockImplementation(async (_name: string, work: () => Promise<boolean>) => ({ acquired: true, value: await work() }))
    mocks.snapshot.mockResolvedValue({ snapshot_at: '2026-08-08T09:04:00.000Z', capacity: { worker_concurrency: 3, worker_instances: 1 }, counts: { queued: 2, running: 1 } })
    mocks.record.mockResolvedValue(undefined)
    mocks.prune.mockResolvedValue(0)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => warn.mockRestore())

  it('skips an initial sample while the API is not ready', async () => {
    mocks.ready.mockReturnValue(false)
    await expect(runServiceStatusSampling()).resolves.toBe(false)
    expect(mocks.advisoryLock).not.toHaveBeenCalled()
  })

  it('writes one leader-elected aggregate and prunes old buckets', async () => {
    await expect(runServiceStatusSampling()).resolves.toBe(true)
    expect(mocks.advisoryLock).toHaveBeenCalledWith('service-status-history-sampler', expect.any(Function))
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ bucketStart: '2026-08-08T09:00:00.000Z', status: 'busy' }))
    expect(mocks.prune).toHaveBeenCalledWith(expect.any(String))
  })

  it('uses total capacity for availability while recording only billable ECS workers', async () => {
    mocks.snapshot.mockResolvedValue({
      snapshot_at: '2026-08-08T09:04:00.000Z',
      capacity: { worker_concurrency: 1, worker_instances: 1, billable_worker_instances: 0 },
      counts: { queued: 0, running: 0 },
    })

    await expect(runServiceStatusSampling()).resolves.toBe(true)
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'available', workerInstances: 0 }))
  })

  it('does not write when another API instance owns the lock', async () => {
    mocks.advisoryLock.mockResolvedValue({ acquired: false })
    await expect(runServiceStatusSampling()).resolves.toBe(false)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('contains storage failures and never blocks the API lifecycle', async () => {
    mocks.snapshot.mockRejectedValue(new Error('private payload should not be logged'))
    await expect(runServiceStatusSampling()).resolves.toBe(false)
    expect(warn.mock.calls.flat().join(' ')).not.toContain('private payload')
  })
})
