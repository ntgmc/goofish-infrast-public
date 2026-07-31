import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initializeJobProcessing,
  initializeQueueMaintenance,
  initializeBehaviorMaintenance,
  initializeAuthMaintenance,
  shutdownJobProcessing,
  shutdownQueueMaintenance,
  shutdownBehaviorMaintenance,
  shutdownAuthMaintenance,
} = vi.hoisted(() => ({
  initializeJobProcessing: vi.fn(async () => undefined),
  initializeQueueMaintenance: vi.fn(async () => undefined),
  initializeBehaviorMaintenance: vi.fn(async () => undefined),
  initializeAuthMaintenance: vi.fn(async () => undefined),
  shutdownJobProcessing: vi.fn(async () => undefined),
  shutdownQueueMaintenance: vi.fn(),
  shutdownBehaviorMaintenance: vi.fn(),
  shutdownAuthMaintenance: vi.fn(),
}))

vi.mock('./optimize-job-runner', () => ({
  initializeOptimizeJobProcessing: initializeJobProcessing,
  shutdownOptimizeJobProcessing: shutdownJobProcessing,
}))
vi.mock('./optimize-queue-maintenance', () => ({
  initializeOptimizeQueueMaintenance: initializeQueueMaintenance,
  shutdownOptimizeQueueMaintenance: shutdownQueueMaintenance,
}))
vi.mock('./behavior-risk-maintenance', () => ({
  initializeBehaviorRiskMaintenance: initializeBehaviorMaintenance,
  shutdownBehaviorRiskMaintenance: shutdownBehaviorMaintenance,
}))
vi.mock('./auth-data-maintenance', () => ({
  initializeAuthDataMaintenance: initializeAuthMaintenance,
  shutdownAuthDataMaintenance: shutdownAuthMaintenance,
}))

import { apiOnlyProcessHooks } from './api-process-hooks'
import { createCombinedProcessHooks } from './combined-process-hooks'
import {
  getRegisteredOptimizerPort,
  OPTIMIZER_PORT_VERSION,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'

beforeEach(() => vi.clearAllMocks())

const optimizerPort: OptimizerPort = {
  version: OPTIMIZER_PORT_VERSION,
  executeSchedule: vi.fn(async () => ({} as never)),
  executeScenarioComparison: vi.fn(async () => ({} as never)),
  executeReorderCheck: vi.fn(async () => ({} as never)),
}

describe('API process hook compositions', () => {
  it('runs queue and authentication maintenance in the API-only lifecycle', async () => {
    await apiOnlyProcessHooks.initialize()
    await apiOnlyProcessHooks.drain()
    await apiOnlyProcessHooks.forceDrain()

    expect(initializeQueueMaintenance).toHaveBeenCalledOnce()
    expect(initializeAuthMaintenance).toHaveBeenCalledOnce()
    expect(shutdownQueueMaintenance).toHaveBeenCalledTimes(2)
    expect(shutdownAuthMaintenance).toHaveBeenCalledTimes(2)
    expect(initializeJobProcessing).not.toHaveBeenCalled()
    expect(shutdownJobProcessing).not.toHaveBeenCalled()
  })

  it('initializes maintenance before processing in the combined lifecycle', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    initializeQueueMaintenance.mockImplementationOnce(async () => {
      expect(getRegisteredOptimizerPort()).toBe(optimizerPort)
    })
    await combinedProcessHooks.initialize()

    expect(initializeQueueMaintenance).toHaveBeenCalledOnce()
    expect(initializeBehaviorMaintenance).toHaveBeenCalledOnce()
    expect(initializeAuthMaintenance).toHaveBeenCalledOnce()
    expect(initializeJobProcessing).toHaveBeenCalledOnce()
    expect(initializeQueueMaintenance.mock.invocationCallOrder[0])
      .toBeLessThan(initializeJobProcessing.mock.invocationCallOrder[0]!)
    await combinedProcessHooks.forceDrain()
  })

  it('drains processing before stopping maintenance in the combined lifecycle', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    await combinedProcessHooks.initialize()
    vi.clearAllMocks()
    await combinedProcessHooks.drain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith()
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownBehaviorMaintenance).toHaveBeenCalledOnce()
    expect(shutdownAuthMaintenance).toHaveBeenCalledOnce()
    expect(shutdownJobProcessing.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownQueueMaintenance.mock.invocationCallOrder[0]!)
    expect(getRegisteredOptimizerPort()).toBeNull()
  })

  it('uses a zero grace period before stopping maintenance on force drain', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    await combinedProcessHooks.initialize()
    vi.clearAllMocks()
    await combinedProcessHooks.forceDrain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith(0)
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownAuthMaintenance).toHaveBeenCalledOnce()
    expect(shutdownJobProcessing.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownQueueMaintenance.mock.invocationCallOrder[0]!)
    expect(getRegisteredOptimizerPort()).toBeNull()
  })

  it('rolls back maintenance and registration when combined initialization fails', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    initializeBehaviorMaintenance.mockRejectedValueOnce(new Error('maintenance failed'))

    await expect(combinedProcessHooks.initialize()).rejects.toThrow('maintenance failed')

    expect(shutdownJobProcessing).toHaveBeenCalledWith(0)
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownBehaviorMaintenance).toHaveBeenCalledOnce()
    expect(shutdownAuthMaintenance).toHaveBeenCalledOnce()
    expect(getRegisteredOptimizerPort()).toBeNull()
  })
})
