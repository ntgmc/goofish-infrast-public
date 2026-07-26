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
import {
  registerOptimizerPort,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'

export function createCombinedProcessHooks(optimizerPort: OptimizerPort): ApiProcessHooks {
  let unregisterOptimizerPort: (() => void) | null = null

  const releaseOptimizerPort = () => {
    unregisterOptimizerPort?.()
    unregisterOptimizerPort = null
  }

  const stop = async (graceMs?: number) => {
    try {
      if (graceMs === undefined) await shutdownOptimizeJobProcessing()
      else await shutdownOptimizeJobProcessing(graceMs)
    } finally {
      try {
        shutdownOptimizeQueueMaintenance()
        shutdownBehaviorRiskMaintenance()
      } finally {
        releaseOptimizerPort()
      }
    }
  }

  return {
    initialize: async () => {
      if (unregisterOptimizerPort) return
      unregisterOptimizerPort = registerOptimizerPort(optimizerPort)
      try {
        await initializeOptimizeQueueMaintenance()
        await initializeBehaviorRiskMaintenance()
        await initializeOptimizeJobProcessing()
      } catch (error) {
        await stop(0).catch(() => undefined)
        throw error
      }
    },
    drain: () => stop(),
    forceDrain: () => stop(0),
  }
}
