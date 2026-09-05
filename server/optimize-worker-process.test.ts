import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRegisteredOptimizerPort,
  OPTIMIZER_PORT_VERSION,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import {
  initializeOptimizeWorkerRuntime,
  runOptimizeWorkerProcess,
} from './optimize-worker-process'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('optimize worker process configuration', () => {
  it('fails synchronously before startup when the optimizer port is missing', () => {
    expect(() => runOptimizeWorkerProcess(undefined as never)).toThrow('OptimizerPort must be an object.')
  })

  it('fails synchronously before startup when the optimizer port version is incompatible', () => {
    expect(() => runOptimizeWorkerProcess({ version: 2 } as never)).toThrow('Unsupported OptimizerPort version: 2')
  })

  it('unregisters the optimizer port when startup configuration is invalid', () => {
    process.env.WORKER_HEALTH_PORT = '0'
    try {
      expect(() => runOptimizeWorkerProcess(fakePort())).toThrow('WORKER_HEALTH_PORT must be an integer')
      expect(getRegisteredOptimizerPort()).toBeNull()
    } finally {
      delete process.env.WORKER_HEALTH_PORT
    }
  })

  it('listens for health checks before initialization and stops advancing while draining', async () => {
    const healthServer = createServer((_request, response) => response.end())
    servers.push(healthServer)
    let lifecycle: 'starting' | 'draining' = 'starting'
    let releaseFirstStage: () => void = () => undefined
    let reportFirstStageStarted: () => void = () => undefined
    const firstStageGate = new Promise<void>((resolve) => {
      releaseFirstStage = resolve
    })
    const firstStageStarted = new Promise<void>((resolve) => {
      reportFirstStageStarted = resolve
    })
    const secondStage = vi.fn(async () => undefined)
    const logs: string[] = []

    const startup = initializeOptimizeWorkerRuntime(
      healthServer,
      0,
      '127.0.0.1',
      () => lifecycle === 'starting',
      [
        {
          name: 'blocking database stage',
          initialize: async () => {
            reportFirstStageStarted()
            await firstStageGate
          },
        },
        { name: 'dispatcher', initialize: secondStage },
      ],
      (message) => logs.push(message),
    )

    await firstStageStarted
    expect(healthServer.listening).toBe(true)
    expect(logs).toEqual([
      '[worker-startup] health server listening on http://127.0.0.1:0',
      '[worker-startup] initializing blocking database stage',
    ])

    lifecycle = 'draining'
    releaseFirstStage()

    await expect(startup).resolves.toBe(false)
    expect(secondStage).not.toHaveBeenCalled()
    expect(logs.at(-1)).toBe('[worker-startup] initialized blocking database stage')
  })
})

function fakePort(): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: async () => ({} as never),
    executeScenarioComparison: async () => ({} as never),
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}
