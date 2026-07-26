import { describe, expect, it, vi } from 'vitest'
import { OPTIMIZER_PORT_VERSION, type OptimizerPort } from './optimization/jobs/optimizer-port'
import { runOptimizeWorkerThread, type OptimizeWorkerData } from './optimize-worker-runtime'

const data: OptimizeWorkerData = {
  job: { payload_json: { version: 3 } } as never,
  context: {
    jobId: 'job-1',
    attemptNo: 1,
    workerId: 'worker-1',
    lockToken: 'lock-1',
    deadlineAtMs: Date.now() + 10_000,
  },
}

describe('optimize worker thread runtime', () => {
  it('forwards progress, success, and database cleanup', async () => {
    const messages: unknown[] = []
    const closeDatabase = vi.fn(async () => undefined)
    const port = fakePort(async (_payload, context) => {
      await context.reportStage?.('generating_schedule')
      return { ok: true } as never
    })

    await runOptimizeWorkerThread({
      optimizerPort: port,
      data,
      messagePort: { postMessage: (message: unknown) => messages.push(message) } as never,
      closeDatabase,
    })

    expect(messages).toEqual([
      { type: 'progress', stage: 'generating_schedule' },
      { type: 'succeeded', result: { ok: true } },
    ])
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('reports execution failures and still closes the database', async () => {
    const messages: unknown[] = []
    const closeDatabase = vi.fn(async () => undefined)
    const port = fakePort(async () => {
      throw new Error('calculation failed')
    })

    await runOptimizeWorkerThread({
      optimizerPort: port,
      data,
      messagePort: { postMessage: (message: unknown) => messages.push(message) } as never,
      closeDatabase,
    })

    expect(messages).toEqual([{ type: 'failed', error: 'calculation failed' }])
    expect(closeDatabase).toHaveBeenCalledOnce()
  })
})

function fakePort(executeSchedule: OptimizerPort['executeSchedule']): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule,
    executeScenarioComparison: vi.fn(async () => ({} as never)),
    executeReorderCheck: vi.fn(async () => ({} as never)),
  }
}
