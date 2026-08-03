import { createServer, type Server } from 'node:http'
import { getBackgroundWorkerHealth, type BackgroundWorkerHealth } from './background-worker-runtime'
import { getOptimizeJobProcessingState } from './optimize-job-runner'
import { checkPostgresHealth } from './storage/postgres'
import { REQUIRED_WORKER_RESPONSIBILITIES } from './worker-lifecycle-stages'

export type WorkerLifecycleState = 'starting' | 'ready' | 'draining' | 'stopped'

type WorkerHealthDependencies = {
  getProcessingState?: typeof getOptimizeJobProcessingState
  checkDatabase?: typeof checkPostgresHealth
  getResponsibilities?: () => BackgroundWorkerHealth[]
}

const processStartedAt = new Date().toISOString()

export function createOptimizeWorkerHealthServer(
  getLifecycleState: () => WorkerLifecycleState,
  dependencies: WorkerHealthDependencies = {},
): Server {
  const getProcessingState = dependencies.getProcessingState ?? getOptimizeJobProcessingState
  const checkDatabase = dependencies.checkDatabase ?? checkPostgresHealth
  const getResponsibilities = dependencies.getResponsibilities
    ?? (() => getBackgroundWorkerHealth(REQUIRED_WORKER_RESPONSIBILITIES))
  const server = createServer({
    maxHeaderSize: 8 * 1024,
    requireHostHeader: true,
    rejectNonStandardBodyWrites: true,
  }, async (req, res) => {
    const pathname = requestPathname(req.url)
    if (req.method !== 'GET' || (pathname !== '/health/live' && pathname !== '/health/ready')) {
      writeJson(res, 404, { ok: false, error: 'not_found' })
      return
    }

    const lifecycle = getLifecycleState()
    const processing = getProcessingState()
    const responsibilities = getResponsibilities()
    if (pathname === '/health/live') {
      writeJson(res, 200, {
        ok: true,
        role: 'worker',
        state: lifecycle,
        build_sha: buildSha(),
        started_at: processStartedAt,
        uptime_seconds: Math.floor(process.uptime()),
        active_attempts: processing.activeAttempts,
      })
      return
    }

    const database = lifecycle === 'ready'
      ? await checkDatabase()
      : { ok: false as const, error: 'worker_not_ready' }
    const ok = lifecycle === 'ready'
      && processing.initialized
      && processing.accepting
      && processing.maintenanceInitialized
      && responsibilities.every((responsibility) => responsibility.initialized && responsibility.healthy)
      && database.ok
    writeJson(res, ok ? 200 : 503, {
      ok,
      role: 'worker',
      state: lifecycle,
      build_sha: buildSha(),
      started_at: processStartedAt,
      uptime_seconds: Math.floor(process.uptime()),
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
      responsibilities,
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50
  server.maxRequestsPerSocket = 50
  server.on('clientError', (error, socket) => {
    if (!socket.writable) return socket.destroy()
    const status = 'code' in error && error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
    socket.end(`HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  })
  server.on('upgrade', (_request, socket) => socket.destroy())
  return server
}

function buildSha(): string | null {
  const configured = process.env.APP_BUILD_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim()
  return configured && /^[A-Za-z0-9._-]{7,64}$/.test(configured) ? configured : null
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
