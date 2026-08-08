import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import { initializeAuthDataMaintenance, shutdownAuthDataMaintenance } from './auth-data-maintenance'
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
  },
  drain: async () => {
    shutdownServiceStatusHistory()
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
    await waitForServiceStatusHistoryIdle()
  },
  forceDrain: () => {
    shutdownServiceStatusHistory()
    shutdownAuthDataMaintenance()
    shutdownOptimizeQueueMaintenance()
  },
}
