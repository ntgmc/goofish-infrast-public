import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'

export const combinedProcessHooks: ApiProcessHooks = {
  initialize: async () => {
    await initializeOptimizeQueueMaintenance()
    await initializeOptimizeJobProcessing()
  },
  drain: async () => {
    await shutdownOptimizeJobProcessing()
    shutdownOptimizeQueueMaintenance()
  },
  forceDrain: async () => {
    await shutdownOptimizeJobProcessing(0)
    shutdownOptimizeQueueMaintenance()
  },
}
