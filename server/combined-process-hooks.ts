import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import { initializeBehaviorRiskMaintenance, shutdownBehaviorRiskMaintenance } from './behavior-risk-maintenance'

export const combinedProcessHooks: ApiProcessHooks = {
  initialize: async () => {
    await initializeOptimizeQueueMaintenance()
    await initializeBehaviorRiskMaintenance()
    await initializeOptimizeJobProcessing()
  },
  drain: async () => {
    await shutdownOptimizeJobProcessing()
    shutdownOptimizeQueueMaintenance()
    shutdownBehaviorRiskMaintenance()
  },
  forceDrain: async () => {
    await shutdownOptimizeJobProcessing(0)
    shutdownOptimizeQueueMaintenance()
    shutdownBehaviorRiskMaintenance()
  },
}
