import { describe, expect, it, vi } from 'vitest'
import { executeOptimizationJobWithPort } from './optimizer-dispatcher'
import {
  OPTIMIZER_PORT_VERSION,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimizer-port'

const context: OptimizeExecutionContext = {
  jobId: 'job-1',
  attemptNo: 2,
  workerId: 'worker-1',
  lockToken: 'lock-1',
  deadlineAtMs: 123_456,
  reportStage: vi.fn(),
}

describe('optimization job dispatcher', () => {
  it('dispatches schedule payloads without a kind', async () => {
    const port = fakePort()
    const payload = { version: 3 }

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeSchedule).toHaveBeenCalledWith(payload, context)
    expect(port.executeScenarioComparison).not.toHaveBeenCalled()
    expect(port.executeReorderCheck).not.toHaveBeenCalled()
  })

  it('dispatches scenario comparison payloads explicitly', async () => {
    const port = fakePort()
    const payload = { version: 3, kind: 'scenario_comparison' }

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeScenarioComparison).toHaveBeenCalledWith(payload, context)
    expect(port.executeSchedule).not.toHaveBeenCalled()
  })

  it('dispatches reorder check payloads explicitly', async () => {
    const port = fakePort()
    const payload = { version: 3, kind: 'reorder_check' }

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeReorderCheck).toHaveBeenCalledWith(payload, context)
    expect(port.executeSchedule).not.toHaveBeenCalled()
  })

  it('rejects incompatible versions and unknown kinds before calling the port', async () => {
    const port = fakePort()

    await expect(executeOptimizationJobWithPort(job({ version: 2 }), context, port))
      .rejects.toThrow('Unsupported optimization job payload version: 2')
    await expect(executeOptimizationJobWithPort(job({ version: 3, kind: 'future_kind' }), context, port))
      .rejects.toThrow('Unsupported optimization job payload version: 3')
    expect(port.executeSchedule).not.toHaveBeenCalled()
    expect(port.executeScenarioComparison).not.toHaveBeenCalled()
    expect(port.executeReorderCheck).not.toHaveBeenCalled()
  })
})

function fakePort(): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: vi.fn(async () => ({} as never)),
    executeScenarioComparison: vi.fn(async () => ({} as never)),
    executeReorderCheck: vi.fn(async () => ({} as never)),
  }
}

function job(payload: unknown) {
  return { payload_json: payload } as never
}
