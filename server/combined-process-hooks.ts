import type { ApiProcessHooks } from './api-process'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import { initializeAuthDataMaintenance, shutdownAuthDataMaintenance } from './auth-data-maintenance'
import {
  registerOptimizerPort,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import {
  initializeWorkerLifecycleStages,
  stopWorkerLifecycleStages,
  waitForWorkerLifecycleStagesIdle,
} from './worker-lifecycle-stages'
import {
  initializeOptimizeWorkerRegistration,
  stopOptimizeWorkerRegistration,
  waitForOptimizeWorkerRegistrationIdle,
} from './optimize-worker-registration'

export function createCombinedProcessHooks(optimizerPort: OptimizerPort): ApiProcessHooks {
  let unregisterOptimizerPort: (() => void) | null = null

  const releaseOptimizerPort = () => {
    unregisterOptimizerPort?.()
    unregisterOptimizerPort = null
  }

  const stop = async (graceMs?: number) => {
    stopOptimizeWorkerRegistration()
    stopWorkerLifecycleStages()
    shutdownAuthDataMaintenance()
    try {
      if (graceMs === undefined) await shutdownOptimizeJobProcessing()
      else await shutdownOptimizeJobProcessing(graceMs)
    } finally {
      try {
        await waitForOptimizeWorkerRegistrationIdle()
        await waitForWorkerLifecycleStagesIdle()
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
        await initializeWorkerLifecycleStages()
        await initializeAuthDataMaintenance()
        await initializeOptimizeJobProcessing()
        await initializeOptimizeWorkerRegistration()
      } catch (error) {
        await stop(0).catch(() => undefined)
        throw error
      }
    },
    drain: () => stop(),
    forceDrain: () => stop(0),
  }
}
