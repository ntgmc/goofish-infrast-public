import { describe, expect, it, vi } from 'vitest'
import { executeOptimizationJobWithPort } from './optimizer-dispatcher'
import {
  OPTIMIZER_PORT_VERSION,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimizer-port'
import { APP_BUILD_META } from '../../../src/lib/build-meta'

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
    const payload = schedulePayload()

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeSchedule).toHaveBeenCalledWith(payload, context)
    expect(port.executeScenarioComparison).not.toHaveBeenCalled()
    expect(port.executeReorderCheck).not.toHaveBeenCalled()
  })

  it('dispatches scenario comparison payloads explicitly', async () => {
    const port = fakePort()
    const payload = scenarioPayload()

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeScenarioComparison).toHaveBeenCalledWith(payload, context)
    expect(port.executeSchedule).not.toHaveBeenCalled()
  })

  it('dispatches reorder check payloads explicitly', async () => {
    const port = fakePort()
    const payload = reorderPayload()

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

  it('accepts undefined object properties that JSON serialization safely omits', async () => {
    const result = {
      ...scheduleResult(),
      schedule_mode: undefined,
      plans: [{
        name: 'Plan 1',
        drones: undefined,
        rooms: {
          trading: [{
            operators: ['Operator'],
            mood: { Operator: { start: 24, end: undefined } },
          }],
        },
      }],
    }
    const port = fakePort({ executeSchedule: vi.fn(async () => result) })

    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context, port))
      .resolves.toEqual(result)
  })

  it('accepts finite control-center efficiency breakdowns', async () => {
    const result = {
      ...scheduleResult(),
      plans: [{
        name: 'Plan 1',
        rooms: {
          control: [{
            operators: ['Operator'],
            efficiency: {
              trading: 0.07,
              manufacturing: 0.03,
              meeting: 0,
              mood_recovery: 0.05,
              hire: 0,
            },
          }],
        },
      }],
    }
    const port = fakePort({ executeSchedule: vi.fn(async () => result) })

    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context, port))
      .resolves.toEqual(result)
  })

  it('accepts the current generated application build metadata', async () => {
    const result = {
      ...scheduleResult(),
      build_meta: { ...APP_BUILD_META },
    }
    const port = fakePort({ executeSchedule: vi.fn(async () => result) })

    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context, port))
      .resolves.toEqual(result)
  })

  it('still rejects non-finite optimizer result values', async () => {
    const port = fakePort({
      executeSchedule: vi.fn(async () => ({
        ...scheduleResult(),
        total_efficiency: Number.POSITIVE_INFINITY,
      })),
    })

    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context, port))
      .rejects.toMatchObject({
        failure: {
          code: 'invalid_optimizer_result',
          kind: 'validation',
          retryable: false,
        },
      })
  })

  it('still rejects non-finite control-center efficiency values', async () => {
    const port = fakePort({
      executeSchedule: vi.fn(async () => ({
        ...scheduleResult(),
        plans: [{
          name: 'Plan 1',
          rooms: {
            control: [{ efficiency: { trading: Number.POSITIVE_INFINITY } }],
          },
        }],
      })),
    })

    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context, port))
      .rejects.toMatchObject({
        failure: {
          code: 'invalid_optimizer_result',
          kind: 'validation',
          retryable: false,
        },
      })
  })

  it('assigns stable suggestion ids and deterministically attaches unavailable training costs', async () => {
    const payload = {
      ...schedulePayload(),
      activeProfileId: null,
      request: { include_upgrade_suggestions: true, upgrade_suggestions_allowed: true },
    }
    const result = {
      ...scheduleResult(),
      upgrade_suggestions: [{
        type: 'single' as const,
        suggestion_id: 'private-unstable-id',
        id: 'op-1',
        name: 'Operator',
        current: 1,
        target: 2,
        gain: 0.1,
      }],
    }
    const reportStage = vi.fn()
    const executionContext = { ...context, reportStage }
    const port = fakePort({ executeSchedule: vi.fn(async () => result) })

    const received = await executeOptimizationJobWithPort(job(payload), executionContext, port)
    expect('upgrade_suggestions' in received && received.upgrade_suggestions?.[0]).toMatchObject({
      suggestion_id: expect.stringMatching(/^upgrade-[a-f0-9]{20}$/),
      training_cost: { status: 'unavailable' },
    })
    expect(reportStage).toHaveBeenCalledWith('enriching_training_costs')
  })
})

function fakePort(overrides: Partial<OptimizerPort> = {}): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: vi.fn(async () => scheduleResult()),
    executeScenarioComparison: vi.fn(async () => scenarioResult()),
    executeReorderCheck: vi.fn(async () => reorderResult()),
    ...overrides,
  }
}

function job(payload: unknown) {
  return { payload_json: payload } as never
}

function config() {
  return {
    layout: '243', desc: 'test', schedule_mode: 'maa', trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: { trading_stations: { lmd: 2 }, manufacturing_stations: { pure_gold: 4 } },
  }
}

function operators() {
  return [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }]
}

function estimate(bucket = 'maa_plain') {
  return { estimated_duration_ms: 2_000, estimate_bucket: bucket, estimate_source: 'fallback_p95', estimate_sample_count: 0 }
}

function schedulePayload() {
  return {
    version: 3, submittedAt: 1, operators: operators(), effectiveConfig: config(), scheduleUsageBase: {},
    activeProfileId: 'profile-1', isPreviewProfile: false, isPreviewTrial: false,
    freeScheduleDecision: null, estimate: estimate(),
    request: { include_upgrade_suggestions: false, upgrade_suggestions_allowed: false },
    configPermission: 'advanced', cdkUsageRef: null,
  }
}

function scenarioPayload() {
  return {
    version: 3, kind: 'scenario_comparison', submittedAt: 1, operators: operators(), effectiveConfig: config(),
    activeProfileId: 'profile-1',
    factors: {
      layouts: [{ layout: '243', plans: [{ trading: { lmd: 2, orundum: 0 }, manufacturing: { pureGold: 4, battleRecord: 0, originiumShard: 0 } }] }],
      maaSchedules: ['8x3'], includeRotation: false, droneStrategies: ['off'],
    },
    estimate: estimate('scenario_comparison'),
  }
}

function reorderPayload() {
  return {
    version: 3, kind: 'reorder_check', submittedAt: 1, operators: operators(), effectiveConfig: config(),
    activeProfileId: 'profile-1', isPreviewTrial: false,
    baseline: { id: 'history-1', name: 'History', created_at: '2026-07-31T00:00:00.000Z', config: config(), result: scheduleResult(), operator_count: 1, source: 'generated' },
    estimate: estimate(),
  }
}

function scheduleResult() {
  return { author: 'test', title: 'result', description: 'result', buildingType: 253, planTimes: '8h', plans: [], raw_results: [] }
}

function scenarioResult() {
  return {
    kind: 'scenario_comparison', scenarioCount: 0, screeningCount: 0, verifiedCount: 0, failedCount: 0,
    rawCombinationCount: 0, skipped: [], points: [], frontierScenarioIds: [],
    frontierBasis: 'fast_top_3_per_actual_operation_cost_then_layout_aware_verification', warnings: [],
    buildMeta: { frontend_version: '1', backend_version: '1', data_version: '1', generated_at: '2026-07-31T00:00:00.000Z', source_summary: 'test' },
  }
}

function reorderResult() {
  return {
    recommendation: 'no_need', estimated_gain_range: { min: null, max: null, unit: 'room_change_only', label: 'none' },
    changed_room_count: 0, affected_facility_types: [], key_operators: [], current_plan_usable: true,
    quota: { limit: 2, used: 1, remaining: 1, reset_at: '2026-08-31T16:00:00.000Z', timezone: 'Asia/Shanghai' },
    baseline: { history_id: 'history-1', created_at: '2026-07-31T00:00:00.000Z', name: 'History' }, reasons: [],
  }
}
