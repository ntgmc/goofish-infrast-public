import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOptimizeWorkerHealthServer,
  type WorkerLifecycleState,
} from './worker-health'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('optimize worker health server', () => {
  it('reports liveness without exposing the worker identifier', async () => {
    const server = await startServer('draining', true, true)
    const response = await fetch(url(server, '/health/live'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      role: 'worker',
      state: 'draining',
      active_attempts: 2,
    })
  })

  it('requires a ready lifecycle, accepting dispatcher, and PostgreSQL', async () => {
    const healthy = await startServer('ready', true, true)
    const healthyResponse = await fetch(url(healthy, '/health/ready'))
    expect(healthyResponse.status).toBe(200)
    await expect(healthyResponse.json()).resolves.toMatchObject({
      ok: true,
      role: 'worker',
      storage: { type: 'postgres', ok: true },
    })

    const unavailable = await startServer('ready', false, true)
    const unavailableResponse = await fetch(url(unavailable, '/health/ready'))
    expect(unavailableResponse.status).toBe(503)
    await expect(unavailableResponse.json()).resolves.toMatchObject({
      ok: false,
      processing: { accepting: false },
    })
  })

  it('reports starting readiness without waiting for PostgreSQL', async () => {
    const checkDatabase = vi.fn(async () => ({ ok: true as const }))
    const server = await startServer('starting', false, false, checkDatabase)
    const response = await fetch(url(server, '/health/ready'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      role: 'worker',
      state: 'starting',
      storage: { type: 'postgres', ok: false },
    })
    expect(checkDatabase).not.toHaveBeenCalled()
  })

  it('rejects unknown routes', async () => {
    const server = await startServer('ready', true, true)
    const response = await fetch(url(server, '/metrics'))
    expect(response.status).toBe(404)
  })
})

async function startServer(
  lifecycle: WorkerLifecycleState,
  accepting: boolean,
  databaseOk: boolean,
  checkDatabase: () => Promise<{ ok: true } | { ok: false; error: string }> = async () => databaseOk
    ? { ok: true as const }
    : { ok: false as const, error: 'unavailable' },
): Promise<Server> {
  const server = createOptimizeWorkerHealthServer(
    () => lifecycle,
    {
      getProcessingState: () => ({
        initialized: true,
        accepting,
        maintenanceInitialized: true,
        activeAttempts: 2,
        workerId: 'secret-worker-id',
      }),
      checkDatabase,
    },
  )
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  servers.push(server)
  return server
}

function url(server: Server, pathname: string): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
  return `http://127.0.0.1:${address.port}${pathname}`
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}
