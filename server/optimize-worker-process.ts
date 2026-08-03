import type { Server } from 'node:http'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import {
  registerOptimizerPort,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import { canRunOptimizeWorker, resolveAppRole } from './process-role'
import { closePool } from './storage/postgres'
import { describeServerError } from './security/error-reporting'
import { ensureDatabaseSchema } from './storage/schema'
import {
  createOptimizeWorkerHealthServer,
  type WorkerLifecycleState,
} from './worker-health'
import {
  getWorkerLifecycleStages,
  stopWorkerLifecycleStages,
  waitForWorkerLifecycleStagesIdle,
} from './worker-lifecycle-stages'
import {
  initializeOptimizeWorkerRegistration,
  stopOptimizeWorkerRegistration,
  waitForOptimizeWorkerRegistrationIdle,
} from './optimize-worker-registration'
import {
  resolveProcessShutdownDeadlineMs,
  scheduleProcessHardExit,
} from './process-shutdown-deadline'

export type OptimizeWorkerStartupStage = {
  name: string
  initialize: () => Promise<void>
}

export function runOptimizeWorkerProcess(optimizerPort: OptimizerPort): void {
  const unregisterOptimizerPort = registerOptimizerPort(optimizerPort)
  let portRegistered = true
  const releaseOptimizerPort = () => {
    if (!portRegistered) return
    portRegistered = false
    unregisterOptimizerPort()
  }

  const healthHost = process.env.WORKER_HEALTH_HOST || '127.0.0.1'
  let healthPort: number

  try {
    healthPort = positivePort(process.env.WORKER_HEALTH_PORT, 3010)
    const appRole = resolveAppRole()
    if (!canRunOptimizeWorker(appRole)) {
      throw new Error(`APP_ROLE=${appRole} cannot start the optimize worker entry point`)
    }
    if (process.env.NODE_ENV === 'production' && appRole !== 'worker') {
      throw new Error('The production optimize worker requires APP_ROLE=worker')
    }
    validateHealthBoundary(healthHost)
    resolveProcessShutdownDeadlineMs()
  } catch (error) {
    releaseOptimizerPort()
    throw error
  }

  let lifecycleState: WorkerLifecycleState = 'starting'
  const healthServer = createOptimizeWorkerHealthServer(() => lifecycleState)
  let shutdownPromise: Promise<void> | null = null
  let cancelHardExit: (() => void) | null = null

  process.on('SIGTERM', () => startShutdown('SIGTERM'))
  process.on('SIGINT', () => startShutdown('SIGINT'))

  void start().catch(async (error) => {
    if (shutdownPromise) return
    cancelHardExit = scheduleProcessHardExit(false)
    console.error('optimize worker startup failed', describeServerError(error))
    lifecycleState = 'draining'
    try {
      stopOptimizeWorkerRegistration()
      shutdownMaintenance()
      await shutdownOptimizeJobProcessing(0).catch(() => undefined)
      await waitForOptimizeWorkerRegistrationIdle()
      await waitForWorkerLifecycleStagesIdle()
      await closeServer(healthServer).catch(() => undefined)
      await closePool().catch(() => undefined)
    } finally {
      releaseOptimizerPort()
      lifecycleState = 'stopped'
      process.exitCode = 1
      cancelHardExit()
      cancelHardExit = null
    }
  })

  async function start(): Promise<void> {
    const initialized = await initializeOptimizeWorkerRuntime(
      healthServer,
      healthPort,
      healthHost,
      () => lifecycleState === 'starting',
    )
    if (!initialized) return
    lifecycleState = 'ready'
    console.log(`goofish optimize worker ready on http://${healthHost}:${healthPort}`)
  }

  function startShutdown(signal: NodeJS.Signals): void {
    if (shutdownPromise) {
      console.warn(`received ${signal} while optimize worker is already draining; forcing active attempts to stop`)
      cancelHardExit?.()
      cancelHardExit = scheduleProcessHardExit(true)
      healthServer.closeAllConnections?.()
      releaseOptimizerPort()
      stopOptimizeWorkerRegistration()
      shutdownMaintenance()
      void shutdownOptimizeJobProcessing(0)
      process.exitCode = 1
      return
    }

    lifecycleState = 'draining'
    cancelHardExit = scheduleProcessHardExit(false)
    shutdownPromise = shutdown(signal)
      .then(() => {
        cancelHardExit?.()
        cancelHardExit = null
      })
      .catch((error) => {
        console.error('optimize worker shutdown failed', describeServerError(error))
        process.exitCode = 1
      })
  }

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    console.log(`received ${signal}; draining optimization workers`)
    stopOptimizeWorkerRegistration()
    shutdownMaintenance()
    try {
      await shutdownOptimizeJobProcessing()
    } finally {
      try {
        await waitForOptimizeWorkerRegistrationIdle()
        await waitForWorkerLifecycleStagesIdle()
        healthServer.closeAllConnections?.()
        await closeServer(healthServer)
        await closePool()
      } finally {
        releaseOptimizerPort()
        lifecycleState = 'stopped'
      }
    }
    console.log('optimize worker shutdown complete')
  }
}

export async function initializeOptimizeWorkerRuntime(
  healthServer: Server,
  healthPort: number,
  healthHost: string,
  shouldContinue: () => boolean,
  stages: readonly OptimizeWorkerStartupStage[] = optimizeWorkerStartupStages(),
  log: (message: string) => void = console.log,
): Promise<boolean> {
  await listen(healthServer, healthPort, healthHost)
  log(`[worker-startup] health server listening on http://${healthHost}:${healthPort}`)

  for (const stage of stages) {
    if (!shouldContinue()) return false
    log(`[worker-startup] initializing ${stage.name}`)
    await stage.initialize()
    log(`[worker-startup] initialized ${stage.name}`)
  }
  return shouldContinue()
}

function optimizeWorkerStartupStages(): readonly OptimizeWorkerStartupStage[] {
  return [
    { name: 'database schema validation', initialize: ensureDatabaseSchema },
    ...getWorkerLifecycleStages().map(({ name, initialize }) => ({ name, initialize })),
    { name: 'optimize job processing', initialize: initializeOptimizeJobProcessing },
    { name: 'worker runtime registration', initialize: initializeOptimizeWorkerRegistration },
  ]
}

function shutdownMaintenance(): void {
  stopWorkerLifecycleStages()
}

function listen(target: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error)
    target.once('error', onError)
    target.listen(port, host, () => {
      target.off('error', onError)
      resolveListen()
    })
  })
}

function closeServer(target: Server): Promise<void> {
  if (!target.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    target.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

function positivePort(value: string | undefined, fallback: number): number {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('WORKER_HEALTH_PORT must be an integer between 1 and 65535')
  }
  return port
}

function validateHealthBoundary(host: string): void {
  if (process.env.NODE_ENV !== 'production') return
  const normalized = host.trim().toLowerCase()
  if (normalized !== '127.0.0.1' && normalized !== '::1' && normalized !== 'localhost') {
    throw new Error('Production worker health HOST must be loopback-only')
  }
}
