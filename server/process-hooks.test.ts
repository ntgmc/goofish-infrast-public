import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initializeJobProcessing,
  initializeQueueMaintenance,
  initializeBehaviorMaintenance,
  initializeInventoryWorker,
  initializeInvitationWorker,
  initializeWorkerRegistration,
  initializeAuthMaintenance,
  shutdownJobProcessing,
  shutdownQueueMaintenance,
  shutdownBehaviorMaintenance,
  shutdownInventoryWorker,
  shutdownInvitationWorker,
  stopWorkerRegistration,
  shutdownAuthMaintenance,
  waitQueueMaintenance,
  waitBehaviorMaintenance,
  waitInventoryWorker,
  waitInvitationWorker,
  waitWorkerRegistration,
  initializeStatusHistory,
  shutdownStatusHistory,
  waitStatusHistory,
} = vi.hoisted(() => ({
  initializeJobProcessing: vi.fn(async () => undefined),
  initializeQueueMaintenance: vi.fn(async () => undefined),
  initializeBehaviorMaintenance: vi.fn(async () => undefined),
  initializeInventoryWorker: vi.fn(async () => undefined),
  initializeInvitationWorker: vi.fn(async () => undefined),
  initializeWorkerRegistration: vi.fn(async () => undefined),
  initializeAuthMaintenance: vi.fn(async () => undefined),
  shutdownJobProcessing: vi.fn(async () => undefined),
  shutdownQueueMaintenance: vi.fn(),
  shutdownBehaviorMaintenance: vi.fn(),
  shutdownInventoryWorker: vi.fn(),
  shutdownInvitationWorker: vi.fn(),
  stopWorkerRegistration: vi.fn(),
  shutdownAuthMaintenance: vi.fn(),
  waitQueueMaintenance: vi.fn(async () => undefined),
  waitBehaviorMaintenance: vi.fn(async () => undefined),
  waitInventoryWorker: vi.fn(async () => undefined),
  waitInvitationWorker: vi.fn(async () => undefined),
  waitWorkerRegistration: vi.fn(async () => undefined),
  initializeStatusHistory: vi.fn(async () => undefined),
  shutdownStatusHistory: vi.fn(),
  waitStatusHistory: vi.fn(async () => undefined),
}))

vi.mock('./optimize-job-runner', () => ({
  initializeOptimizeJobProcessing: initializeJobProcessing,
  shutdownOptimizeJobProcessing: shutdownJobProcessing,
}))
vi.mock('./optimize-queue-maintenance', () => ({
  initializeOptimizeQueueMaintenance: initializeQueueMaintenance,
  shutdownOptimizeQueueMaintenance: shutdownQueueMaintenance,
  waitForOptimizeQueueMaintenanceIdle: waitQueueMaintenance,
}))
vi.mock('./behavior-risk-maintenance', () => ({
  initializeBehaviorRiskMaintenance: initializeBehaviorMaintenance,
  shutdownBehaviorRiskMaintenance: shutdownBehaviorMaintenance,
  waitForBehaviorRiskMaintenanceIdle: waitBehaviorMaintenance,
}))
vi.mock('./inventory-campaign-worker', () => ({
  initializeInventoryCampaignWorker: initializeInventoryWorker,
  shutdownInventoryCampaignWorker: shutdownInventoryWorker,
  waitForInventoryCampaignWorkerIdle: waitInventoryWorker,
}))
vi.mock('./invitation-settlement-worker', () => ({
  initializeInvitationSettlementWorker: initializeInvitationWorker,
  shutdownInvitationSettlementWorker: shutdownInvitationWorker,
  waitForInvitationSettlementWorkerIdle: waitInvitationWorker,
}))
vi.mock('./optimize-worker-registration', () => ({
  initializeOptimizeWorkerRegistration: initializeWorkerRegistration,
  stopOptimizeWorkerRegistration: stopWorkerRegistration,
  waitForOptimizeWorkerRegistrationIdle: waitWorkerRegistration,
}))
vi.mock('./auth-data-maintenance', () => ({
  initializeAuthDataMaintenance: initializeAuthMaintenance,
  shutdownAuthDataMaintenance: shutdownAuthMaintenance,
}))
vi.mock('./service-status-history', () => ({
  initializeServiceStatusHistory: initializeStatusHistory,
  shutdownServiceStatusHistory: shutdownStatusHistory,
  waitForServiceStatusHistoryIdle: waitStatusHistory,
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
    expect(initializeStatusHistory).toHaveBeenCalledOnce()
    expect(shutdownQueueMaintenance).toHaveBeenCalledTimes(2)
    expect(shutdownAuthMaintenance).toHaveBeenCalledTimes(2)
    expect(shutdownStatusHistory).toHaveBeenCalledTimes(2)
    expect(waitStatusHistory).toHaveBeenCalledOnce()
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
    expect(initializeInventoryWorker).toHaveBeenCalledOnce()
    expect(initializeInvitationWorker).toHaveBeenCalledOnce()
    expect(initializeAuthMaintenance).toHaveBeenCalledOnce()
    expect(initializeStatusHistory).toHaveBeenCalledOnce()
    expect(initializeJobProcessing).toHaveBeenCalledOnce()
    expect(initializeWorkerRegistration).toHaveBeenCalledOnce()
    expect(initializeQueueMaintenance.mock.invocationCallOrder[0])
      .toBeLessThan(initializeJobProcessing.mock.invocationCallOrder[0]!)
    await combinedProcessHooks.forceDrain()
  })

  it('stops scheduling before draining processing and waits for background work', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    await combinedProcessHooks.initialize()
    vi.clearAllMocks()
    await combinedProcessHooks.drain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith()
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownBehaviorMaintenance).toHaveBeenCalledOnce()
    expect(shutdownInventoryWorker).toHaveBeenCalledOnce()
    expect(shutdownInvitationWorker).toHaveBeenCalledOnce()
    expect(stopWorkerRegistration).toHaveBeenCalledOnce()
    expect(shutdownStatusHistory).toHaveBeenCalledOnce()
    expect(shutdownAuthMaintenance).toHaveBeenCalledOnce()
    expect(shutdownQueueMaintenance.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownJobProcessing.mock.invocationCallOrder[0]!)
    expect(waitWorkerRegistration).toHaveBeenCalledOnce()
    expect(waitStatusHistory).toHaveBeenCalledOnce()
    expect(waitQueueMaintenance).toHaveBeenCalledOnce()
    expect(getRegisteredOptimizerPort()).toBeNull()
  })

  it('uses a zero grace period before stopping maintenance on force drain', async () => {
    const combinedProcessHooks = createCombinedProcessHooks(optimizerPort)
    await combinedProcessHooks.initialize()
    vi.clearAllMocks()
    await combinedProcessHooks.forceDrain()

    expect(shutdownJobProcessing).toHaveBeenCalledWith(0)
    expect(shutdownQueueMaintenance).toHaveBeenCalledOnce()
    expect(shutdownInventoryWorker).toHaveBeenCalledOnce()
    expect(shutdownInvitationWorker).toHaveBeenCalledOnce()
    expect(shutdownStatusHistory).toHaveBeenCalledOnce()
    expect(shutdownAuthMaintenance).toHaveBeenCalledOnce()
    expect(shutdownQueueMaintenance.mock.invocationCallOrder[0])
      .toBeLessThan(shutdownJobProcessing.mock.invocationCallOrder[0]!)
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
