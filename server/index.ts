import type { Server } from 'node:http'
import { createApiServer } from './http-server'
import {
  type AccountDeletionWorkerController,
  startAccountDeletionWorker,
} from './account-data-lifecycle'
import {
  initializeOptimizeJobProcessing,
  shutdownOptimizeJobProcessing,
} from './optimize-job-runner'
import {
  beginServiceDrain,
  getServiceLifecycleState,
  markServiceReady,
  markServiceStopped,
} from './lifecycle'
import { closePool } from './storage/postgres'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '127.0.0.1'

validateProductionBoundaryConfig(host)

const server = createApiServer()
let accountDeletionWorker: AccountDeletionWorkerController | null = null
let shutdownPromise: Promise<void> | null = null

process.on('SIGTERM', () => startShutdown('SIGTERM'))
process.on('SIGINT', () => startShutdown('SIGINT'))

void start().catch(async (error) => {
  console.error('server startup failed:', error)
  beginServiceDrain()
  accountDeletionWorker?.stop()
  await accountDeletionWorker?.waitForIdle().catch(() => undefined)
  await closePool().catch(() => undefined)
  markServiceStopped()
  process.exitCode = 1
})

async function start(): Promise<void> {
  await initializeOptimizeJobProcessing()
  if (getServiceLifecycleState() !== 'starting') return
  accountDeletionWorker = startAccountDeletionWorker()
  if (getServiceLifecycleState() !== 'starting') {
    accountDeletionWorker.stop()
    await accountDeletionWorker.waitForIdle()
    return
  }
  await listen(server, port, host)
  markServiceReady()
  console.log(`goofish-infrast-v1 API listening on http://${host}:${port}`)
}

function startShutdown(signal: NodeJS.Signals): void {
  if (shutdownPromise) {
    console.warn(`received ${signal} while already draining; forcing open HTTP connections closed`)
    server.closeAllConnections?.()
    void shutdownOptimizeJobProcessing(0)
    process.exitCode = 1
    return
  }

  beginServiceDrain()
  shutdownPromise = shutdown(signal)
    .catch((error) => {
      console.error('server shutdown failed:', error)
      process.exitCode = 1
    })
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`received ${signal}; draining HTTP and optimization workers`)
  accountDeletionWorker?.stop()
  const httpClosed = closeServer(server)
  server.closeIdleConnections?.()

  await shutdownOptimizeJobProcessing()
  server.closeAllConnections?.()
  await httpClosed
  await accountDeletionWorker?.waitForIdle()
  await closePool()
  markServiceStopped()
  console.log('server shutdown complete')
}

function listen(target: Server, listenPort: number, listenHost: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error)
    target.once('error', onError)
    target.listen(listenPort, listenHost, () => {
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
