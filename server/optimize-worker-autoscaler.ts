import {
  getOptimizeWorkerAutoscalingConfiguration,
  type OptimizeWorkerAutoscalingConfiguration,
} from './optimize-job-config'
import {
  createAliyunEcsWorkerControllerFromEnvironment,
  type AliyunEcsWorkerController,
} from './aliyun-ecs-worker-controller'
import { canServeApi } from './process-role'
import { createBackgroundWorker, type BackgroundWorkerController } from './background-worker-runtime'
import { getOptimizeQueueLoad, type OptimizeQueueLoad } from './storage/optimize-job-store'
import { hasDatabaseUrl, withPostgresAdvisoryLock } from './storage/postgres'

const OPTIMIZE_WORKER_AUTOSCALER_ADVISORY_LOCK = 'optimize-worker-autoscaler'

type OptimizeWorkerAutoscalerAction = 'started' | 'stopped' | 'waiting' | 'noop'

export type OptimizeWorkerAutoscalerOptions = {
  worker: AliyunEcsWorkerController
  configuration?: Pick<
    OptimizeWorkerAutoscalingConfiguration,
    'scaleUpQueueThreshold' | 'scaleDownQueueThreshold' | 'scaleDownIdleMs'
  >
  readQueueLoad: () => Promise<OptimizeQueueLoad>
  now?: () => number
}

export type OptimizeWorkerAutoscaler = {
  runOnce: () => Promise<OptimizeWorkerAutoscalerAction>
  getLowQueueSince: () => number | null
}

export function createOptimizeWorkerAutoscaler(
  options: OptimizeWorkerAutoscalerOptions,
): OptimizeWorkerAutoscaler {
  const configuration = options.configuration ?? getOptimizeWorkerAutoscalingConfiguration()
  const now = options.now ?? Date.now
  let lowQueueSince: number | null = null
  let powerOperation: 'start' | 'stop' | null = null

  return {
    runOnce: async () => {
      const load = await options.readQueueLoad()
      const status = await options.worker.getStatus()

      if (status === 'running' && powerOperation === 'start') powerOperation = null
      if (status === 'stopped' && powerOperation === 'stop') powerOperation = null

      if (load.queued > configuration.scaleUpQueueThreshold) {
        lowQueueSince = null
        if (powerOperation === 'start') return 'waiting'
        if (status === 'stopped') {
          await options.worker.start()
          powerOperation = 'start'
          return 'started'
        }
        // An unknown or transitional state is deliberately left alone. The
        // next tick will observe the state again instead of issuing duplicate
        // power operations while ECS is still converging.
        return status === 'unknown' || status === 'starting' || status === 'stopping'
          ? 'waiting'
          : 'noop'
      }

      if (load.queued > configuration.scaleDownQueueThreshold) {
        lowQueueSince = null
        return 'noop'
      }

      if (status === 'stopped') {
        lowQueueSince = null
        return 'noop'
      }
      if (lowQueueSince === null) lowQueueSince = now()
      if (now() - lowQueueSince < configuration.scaleDownIdleMs) return 'waiting'

      // Never stop an instance while an attempt is still running. This keeps
      // the worker lease and graceful shutdown protocol intact.
      if (load.running > 0 || status !== 'running') return 'waiting'
      if (powerOperation === 'stop') return 'waiting'
      await options.worker.stop()
      powerOperation = 'stop'
      lowQueueSince = null
      return 'stopped'
    },
    getLowQueueSince: () => lowQueueSince,
  }
}

let controller: BackgroundWorkerController | null = null
let drainingController: BackgroundWorkerController | null = null
let autoscaler: OptimizeWorkerAutoscaler | null = null

export async function initializeOptimizeWorkerAutoscaling(): Promise<void> {
  if (!canServeApi() || controller) return
  await drainingController?.waitForIdle()
  drainingController = null
  const configuration = getOptimizeWorkerAutoscalingConfiguration()
  if (!configuration.enabled) return
  const worker = createAliyunEcsWorkerControllerFromEnvironment()
  if (!worker) {
    throw new Error(
      'OPTIMIZE_WORKER_AUTOSCALING_ENABLED=true requires the Aliyun ECS worker credentials and instance configuration',
    )
  }
  autoscaler = createOptimizeWorkerAutoscaler({
    worker,
    configuration,
    readQueueLoad: getOptimizeQueueLoad,
  })
  controller = createBackgroundWorker({
    name: 'optimize_worker_autoscaler',
    intervalMs: configuration.intervalMs,
    maximumBackoffMs: Math.max(configuration.intervalMs, configuration.intervalMs * 8),
    run: async () => {
      const action = await runAutoscalingTick()
      return action === 'started' || action === 'stopped'
    },
    logError: (message, error) => console.warn(message, {
      name: error.name,
      code: error.code,
    }),
  })
  try {
    await controller.initialize()
  } catch (error) {
    controller.stop()
    controller = null
    autoscaler = null
    throw error
  }
}

export function shutdownOptimizeWorkerAutoscaling(): void {
  if (controller) {
    controller.stop()
    drainingController = controller
  }
  controller = null
  autoscaler = null
}

export async function waitForOptimizeWorkerAutoscalingIdle(): Promise<void> {
  await controller?.waitForIdle()
  await drainingController?.waitForIdle()
  drainingController = null
}

async function runAutoscalingTick(): Promise<OptimizeWorkerAutoscalerAction> {
  if (!autoscaler) return 'noop'
  return runAutoscalerAsLeader(autoscaler)
}

async function runAutoscalerAsLeader(
  current: OptimizeWorkerAutoscaler,
): Promise<OptimizeWorkerAutoscalerAction> {
  if (!hasDatabaseUrl()) return current.runOnce()
  const result = await withPostgresAdvisoryLock(
    OPTIMIZE_WORKER_AUTOSCALER_ADVISORY_LOCK,
    current.runOnce,
  )
  if (!result.acquired) {
    console.info('[optimize-worker-autoscaler] leader lock busy; run skipped')
    return 'waiting'
  }
  if (result.value !== 'noop') {
    console.info(`[optimize-worker-autoscaler] ${result.value}`)
  }
  return result.value
}
