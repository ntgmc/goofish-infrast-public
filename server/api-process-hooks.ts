import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import { initializeAuthDataMaintenance, shutdownAuthDataMaintenance } from './auth-data-maintenance'

export const apiOnlyProcessHooks: ApiProcessHooks = {
  initialize: async () => {
    await initializeOptimizeQueueMaintenance()
    await initializeAuthDataMaintenance()
  },
  drain: async () => {
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
  },
  forceDrain: () => {
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
  },
}
