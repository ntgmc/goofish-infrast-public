import { createServer, type Server } from 'node:http'
import { getOptimizeJobProcessingState } from './optimize-job-runner'
import { checkPostgresHealth } from './storage/postgres'

export type WorkerLifecycleState = 'starting' | 'ready' | 'draining' | 'stopped'

type WorkerHealthDependencies = {
  getProcessingState?: typeof getOptimizeJobProcessingState
  checkDatabase?: typeof checkPostgresHealth
}

export function createOptimizeWorkerHealthServer(
  getLifecycleState: () => WorkerLifecycleState,
  dependencies: WorkerHealthDependencies = {},
): Server {
  const getProcessingState = dependencies.getProcessingState ?? getOptimizeJobProcessingState
  const checkDatabase = dependencies.checkDatabase ?? checkPostgresHealth
  return createServer(async (req, res) => {
    const pathname = requestPathname(req.url)
    if (req.method !== 'GET' || (pathname !== '/health/live' && pathname !== '/health/ready')) {
      writeJson(res, 404, { ok: false, error: 'not_found' })
      return
    }

    const lifecycle = getLifecycleState()
    const processing = getProcessingState()
    if (pathname === '/health/live') {
      writeJson(res, 200, {
        ok: true,
        role: 'worker',
        state: lifecycle,
        active_attempts: processing.activeAttempts,
      })
      return
    }

    const database = await checkDatabase()
    const ok = lifecycle === 'ready'
      && processing.initialized
      && processing.accepting
      && database.ok
    writeJson(res, ok ? 200 : 503, {
      ok,
      role: 'worker',
      state: lifecycle,
      processing: {
        initialized: processing.initialized,
        accepting: processing.accepting,
        maintenance_initialized: processing.maintenanceInitialized,
        active_attempts: processing.activeAttempts,
      },
      storage: {
        type: 'postgres',
        ok: database.ok,
      },
    })
  })
}

function requestPathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://worker.invalid').pathname
  } catch {
    return '/invalid-request-url'
  }
}

function writeJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  const serialized = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(serialized),
  })
  response.end(serialized)
}
