import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initializeJobProcessing,
  initializeQueueMaintenance,
  shutdownJobProcessing,
  shutdownQueueMaintenance,
} = vi.hoisted(() => ({
  initializeJobProcessing: vi.fn(async () => undefined),
  initializeQueueMaintenance: vi.fn(async () => undefined),
  shutdownJobProcessing: vi.fn(async () => undefined),
  shutdownQueueMaintenance: vi.fn(),
}))

vi.mock('./optimize-job-runner', () => ({
  initializeOptimizeJobProcessing: initializeJobProcessing,
  shutdownOptimizeJobProcessing: shutdownJobProcessing,
}))
vi.mock('./optimize-queue-maintenance', () => ({
  initializeOptimizeQueueMaintenance: initializeQueueMaintenance,
  shutdownOptimizeQueueMaintenance: shutdownQueueMaintenance,
}))

import { apiOnlyProcessHooks } from './api-process-hooks'
import { combinedProcessHooks } from './combined-process-hooks'

beforeEach(() => vi.clearAllMocks())

describe('API process hook compositions', () => {
  it('keeps the API-only lifecycle limited to queue maintenance', async () => {
    await apiOnlyProcessHooks.initialize()
    await apiOnlyProcessHooks.drain()
    await apiOnlyProcessHooks.forceDrain()

    expect(initializeQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownQueueMaintenance).toHaveBeenCalledTimes(2)
    expect(initializeJobProcessing).not.toHaveBeenCalled()
    expect(shutdownJobProcessing).not.toHaveBeenCalled()
  })

  it('initializes maintenance before processing in the combined lifecycle', async () => {
    await combinedProcessHooks.initialize()

    expect(initializeQueueMaintenance).toHaveBeenCalledOnce()
    expect(initializeJobProcessing).toHaveBeenCalledOnce()
    expect(initializeQueueMaintenance.mock.invocationCallOrder[0])
      .toBeLessThan(initializeJobProcessing.mock.invocationCallOrder[0]!)
  })

  it('drains processing before stopping maintenance in the combined lifecycle', async () => {
    await combinedProcessHooks.drain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith()
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownJobProcessing.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownQueueMaintenance.mock.invocationCallOrder[0]!)
  })

  it('uses a zero grace period before stopping maintenance on force drain', async () => {
    await combinedProcessHooks.forceDrain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith(0)
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownJobProcessing.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownQueueMaintenance.mock.invocationCallOrder[0]!)
  })
})
