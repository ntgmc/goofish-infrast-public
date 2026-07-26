import { describe, expect, it } from 'vitest'
import {
  getRegisteredOptimizerPort,
  OPTIMIZER_PORT_VERSION,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import { runOptimizeWorkerProcess } from './optimize-worker-process'

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
})

function fakePort(): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: async () => ({} as never),
    executeScenarioComparison: async () => ({} as never),
    executeReorderCheck: async () => ({} as never),
  }
}
