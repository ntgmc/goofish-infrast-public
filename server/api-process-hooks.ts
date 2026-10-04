import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import { initializeAuthDataMaintenance, shutdownAuthDataMaintenance } from './auth-data-maintenance'
import { initializeCultivationMaintenance, shutdownCultivationMaintenance } from './cultivation/maintenance'
import {
  initializeServiceStatusHistory,
  shutdownServiceStatusHistory,
  waitForServiceStatusHistoryIdle,
} from './service-status-history'

export const apiOnlyProcessHooks: ApiProcessHooks = {
  initialize: async () => {
    await initializeOptimizeQueueMaintenance()
    await initializeAuthDataMaintenance()
    await initializeServiceStatusHistory()
    initializeCultivationMaintenance()
  },
  drain: async () => {
    shutdownServiceStatusHistory()
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
    await shutdownCultivationMaintenance()
    await waitForServiceStatusHistoryIdle()
  },
  forceDrain: () => {
    shutdownServiceStatusHistory()
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
    void shutdownCultivationMaintenance()
  },
}
