import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'

export const apiOnlyProcessHooks: ApiProcessHooks = {
  initialize: initializeOptimizeQueueMaintenance,
  drain: async () => shutdownOptimizeQueueMaintenance(),
  forceDrain: shutdownOptimizeQueueMaintenance,
}
