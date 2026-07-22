import type { Server } from 'node:http'
import {
  type AccountDeletionWorkerController,
  startAccountDeletionWorker,
} from './account-data-lifecycle'
import { createApiServer } from './http-server'
import {
  beginServiceDrain,
  getServiceLifecycleState,
  markServiceReady,
  markServiceStopped,
} from './lifecycle'
import { closePool } from './storage/postgres'

export type ApiProcessHooks = {
  initialize: () => Promise<void>
  drain: () => Promise<void>
  forceDrain: () => void | Promise<void>
}

type ApiProcessDependencies = {
  createServer?: typeof createApiServer
  startAccountDeletion?: typeof startAccountDeletionWorker
  closeDatabase?: typeof closePool
  host?: string
  port?: number
}

export type ApiProcessController = {
  server: Server
  start: () => Promise<void>
  handleStartupFailure: (error: unknown) => Promise<void>
  startShutdown: (signal: NodeJS.Signals) => Promise<void>
}

export function runApiProcess(hooks: ApiProcessHooks): void {
  const controller = createApiProcess(hooks)
  process.on('SIGTERM', () => void controller.startShutdown('SIGTERM'))
  process.on('SIGINT', () => void controller.startShutdown('SIGINT'))
  void controller.start().catch((error) => controller.handleStartupFailure(error))
}

export function createApiProcess(
  hooks: ApiProcessHooks,
  dependencies: ApiProcessDependencies = {},
): ApiProcessController {
  const port = dependencies.port ?? Number(process.env.PORT || 3000)
  const host = dependencies.host ?? process.env.HOST ?? '127.0.0.1'
  validateProductionBoundaryConfig(host)

  const server = (dependencies.createServer ?? createApiServer)()
  const startAccountDeletion = dependencies.startAccountDeletion ?? startAccountDeletionWorker
  const closeDatabase = dependencies.closeDatabase ?? closePool
  let accountDeletionWorker: AccountDeletionWorkerController | null = null
  let shutdownPromise: Promise<void> | null = null

  async function start(): Promise<void> {
    await hooks.initialize()
    if (getServiceLifecycleState() !== 'starting') return
    accountDeletionWorker = startAccountDeletion()
    if (getServiceLifecycleState() !== 'starting') {
      accountDeletionWorker.stop()
      await accountDeletionWorker.waitForIdle()
      return
    }
    await listen(server, port, host)
    markServiceReady()
    console.log(`goofish-infrast-v1 API listening on http://${host}:${port}`)
  }

  async function handleStartupFailure(error: unknown): Promise<void> {
    console.error('server startup failed:', error)
    beginServiceDrain()
    accountDeletionWorker?.stop()
    await Promise.resolve(hooks.forceDrain()).catch((forceDrainError) => {
      console.error('server startup force drain failed:', forceDrainError)
    })
    server.closeAllConnections?.()
    await closeServer(server).catch(() => undefined)
    await accountDeletionWorker?.waitForIdle().catch(() => undefined)
    await closeDatabase().catch(() => undefined)
    markServiceStopped()
    process.exitCode = 1
  }

  function startShutdown(signal: NodeJS.Signals): Promise<void> {
    if (shutdownPromise) {
      console.warn(`received ${signal} while already draining; forcing open HTTP connections closed`)
      server.closeAllConnections?.()
      void Promise.resolve(hooks.forceDrain()).catch((error) => {
        console.error('server force drain failed:', error)
      })
      process.exitCode = 1
      return shutdownPromise
    }

    beginServiceDrain()
    shutdownPromise = shutdown(signal).catch((error) => {
      console.error('server shutdown failed:', error)
      process.exitCode = 1
    })
    return shutdownPromise
  }

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    console.log(`received ${signal}; draining API process`)
    accountDeletionWorker?.stop()
    const httpClosed = closeServer(server)
    server.closeIdleConnections?.()

    await hooks.drain()
    server.closeAllConnections?.()
    await httpClosed
    await accountDeletionWorker?.waitForIdle()
    await closeDatabase()
    markServiceStopped()
    console.log('server shutdown complete')
  }

  return { server, start, handleStartupFailure, startShutdown }
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

function validateProductionBoundaryConfig(listenHost: string): void {
  if (process.env.NODE_ENV !== 'production') return
  const normalizedHost = listenHost.trim().toLowerCase()
  if (normalizedHost !== '127.0.0.1' && normalizedHost !== '::1' && normalizedHost !== 'localhost') {
    throw new Error('Production backend HOST must be loopback-only')
  }
  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim()
  if (!publicAppUrl) throw new Error('PUBLIC_APP_URL is required in production')
  let parsed: URL
  try {
    parsed = new URL(publicAppUrl)
  } catch {
    throw new Error('PUBLIC_APP_URL must be a valid absolute URL')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_APP_URL must be an HTTPS origin without credentials, path, query, or fragment')
  }
}
