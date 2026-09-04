import { describe, expect, it, vi } from 'vitest'
import { OPTIMIZER_PORT_VERSION, type OptimizerPort } from './optimization/jobs/optimizer-port'
import { runOptimizeWorkerThread, type OptimizeWorkerData } from './optimize-worker-runtime'

const data: OptimizeWorkerData = {
  job: { payload_json: schedulePayload() } as never,
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
      return scheduleResult()
    })

    await runOptimizeWorkerThread({
      optimizerPort: port,
      data,
      messagePort: { postMessage: (message: unknown) => messages.push(message) } as never,
      closeDatabase,
    })

    expect(messages).toEqual([
      { type: 'progress', stage: 'generating_schedule' },
      { type: 'succeeded', result: scheduleResult() },
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

    expect(messages).toEqual([{
      type: 'failed',
      failure: {
        protocolVersion: 1,
        code: 'optimizer_transient_error',
        kind: 'transient',
        retryable: true,
        publicMessage: '优化服务暂时不可用，系统将自动重试。',
        internalMessage: 'calculation failed',
      },
    }])
    expect(closeDatabase).toHaveBeenCalledOnce()
  })
})

function fakePort(executeSchedule: OptimizerPort['executeSchedule']): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule,
    executeScenarioComparison: vi.fn(async () => ({} as never)),
  }
}

function schedulePayload() {
  return {
    version: 3,
    submittedAt: 1,
    operators: [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }],
    effectiveConfig: {
      layout: '243', desc: 'test', schedule_mode: 'maa', trading_stations_count: 2,
      manufacturing_stations_count: 4,
      product_requirements: { trading_stations: { lmd: 2 }, manufacturing_stations: { pure_gold: 4 } },
    },
    scheduleUsageBase: {}, activeProfileId: 'profile-1', isPreviewProfile: false, isPreviewTrial: false,
    freeScheduleDecision: null,
    estimate: { estimated_duration_ms: 2_000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0 },
    request: { include_upgrade_suggestions: false, upgrade_suggestions_allowed: false },
    configPermission: 'advanced', cdkUsageRef: null,
  }
}

function scheduleResult() {
  return { author: 'test', title: 'result', description: 'result', buildingType: 2, planTimes: '8h', plans: [], raw_results: [] }
}
