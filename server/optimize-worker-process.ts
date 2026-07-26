import type { Server } from 'node:http'
import { initializeBehaviorRiskMaintenance, shutdownBehaviorRiskMaintenance } from './behavior-risk-maintenance'
import { initializeInventoryCampaignWorker, shutdownInventoryCampaignWorker } from './inventory-campaign-worker'
import { initializeInvitationSettlementWorker, shutdownInvitationSettlementWorker } from './invitation-settlement-worker'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
} from './optimize-queue-maintenance'
import {
  registerOptimizerPort,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import { canRunOptimizeWorker, resolveAppRole } from './process-role'
import { closePool } from './storage/postgres'
import {
  createOptimizeWorkerHealthServer,
  type WorkerLifecycleState,
} from './worker-health'

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
  } catch (error) {
    releaseOptimizerPort()
    throw error
  }

  let lifecycleState: WorkerLifecycleState = 'starting'
  const healthServer = createOptimizeWorkerHealthServer(() => lifecycleState)
  let shutdownPromise: Promise<void> | null = null

  process.on('SIGTERM', () => startShutdown('SIGTERM'))
  process.on('SIGINT', () => startShutdown('SIGINT'))

  void start().catch(async (error) => {
    console.error('optimize worker startup failed:', error)
    lifecycleState = 'draining'
    try {
      await shutdownOptimizeJobProcessing(0).catch(() => undefined)
      shutdownMaintenance()
      await closeServer(healthServer).catch(() => undefined)
      await closePool().catch(() => undefined)
    } finally {
      releaseOptimizerPort()
      lifecycleState = 'stopped'
      process.exitCode = 1
    }
  })

  async function start(): Promise<void> {
    await initializeOptimizeQueueMaintenance()
    await initializeInventoryCampaignWorker()
    await initializeInvitationSettlementWorker()
    await initializeBehaviorRiskMaintenance()
    await initializeOptimizeJobProcessing()
    await listen(healthServer, healthPort, healthHost)
    lifecycleState = 'ready'
    console.log(`goofish optimize worker ready on http://${healthHost}:${healthPort}`)
  }

  function startShutdown(signal: NodeJS.Signals): void {
    if (shutdownPromise) {
      console.warn(`received ${signal} while optimize worker is already draining; forcing active attempts to stop`)
      healthServer.closeAllConnections?.()
      releaseOptimizerPort()
      void shutdownOptimizeJobProcessing(0)
      process.exitCode = 1
      return
    }

    lifecycleState = 'draining'
    shutdownPromise = shutdown(signal).catch((error) => {
      console.error('optimize worker shutdown failed:', error)
      process.exitCode = 1
    })
  }

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    console.log(`received ${signal}; draining optimization workers`)
    try {
      await shutdownOptimizeJobProcessing()
    } finally {
      try {
        shutdownMaintenance()
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

function shutdownMaintenance(): void {
  shutdownOptimizeQueueMaintenance()
  shutdownInventoryCampaignWorker()
  shutdownInvitationSettlementWorker()
  shutdownBehaviorRiskMaintenance()
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
