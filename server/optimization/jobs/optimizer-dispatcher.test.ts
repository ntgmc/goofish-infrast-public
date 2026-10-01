import { describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../src/lib/config'
import type { OptimizeResult } from '../../../src/lib/types'
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
  it('validates dormitory recovery suggestions and retains all degrading operators', async () => {
    const result = {
      ...scheduleResult(),
      mood_simulation: {
        valid: false, daily_loop_stable: false, iterations: 12,
        degrading_operators: Array.from({ length: 13 }, (_, index) => ({ operator: `Operator ${index}`, start: 24, end: 20 })),
        dormitory_recovery: {
          additions: [{ shift_index: 0, room_index: 0, operator: 'Operator' }],
          unassigned: [{ shift_index: 1, operator: 'Another operator' }],
        },
      },
    }
    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context,
      fakePort({ executeSchedule: vi.fn(async () => result) }))).resolves.toEqual(result)
    result.mood_simulation.dormitory_recovery.additions[0].room_index = -1
    await expect(executeOptimizationJobWithPort(job(schedulePayload()), context,
      fakePort({ executeSchedule: vi.fn(async () => result) }))).rejects.toMatchObject({
      failure: { code: 'invalid_optimizer_result', kind: 'validation' },
    })
  })
  it('requires explicit manual simulation support before dispatching fixed plans', async () => {
    const baseline = schedulePayload()
    const payload = { ...baseline, request: { ...baseline.request, manual_schedule: scheduleResult() } }
    const port = fakePort()
    await expect(executeOptimizationJobWithPort(job(payload), context, port))
      .rejects.toThrow('does not support manual schedule simulation')
    expect(port.executeSchedule).not.toHaveBeenCalled()
    await executeOptimizationJobWithPort(job(payload), context, { ...port, supportsManualScheduleSimulation: true })
    expect(port.executeSchedule).toHaveBeenCalledWith(payload, context)
  })
  it.each(['252', '252-1'])('includes %s room levels in schedule result data', async (preset) => {
    const payload = schedulePayload()
    payload.effectiveConfig = structuredClone(CONFIG_PRESETS[preset])
    payload.effectiveConfig.facility_layout = ['manufacture_3', 'trading_2', 'power_2', 'manufacture_1', 'manufacture_4', 'trading_1', 'power_1', 'manufacture_5', 'manufacture_2']
    const result = {
      ...scheduleResult(),
      plans: [{ name: 'Plan 1', rooms: {
        trading: Array.from({ length: 2 }, () => ({ operators: ['Operator'] })),
        manufacture: Array.from({ length: 5 }, () => ({ operators: ['Operator'] })),
      } }],
    }
    const port = fakePort({ executeSchedule: vi.fn(async () => result) })
    const actual = await executeOptimizationJobWithPort(job(payload), context, port) as OptimizeResult
    expect(actual.facility_layout).toEqual(payload.effectiveConfig.facility_layout)
    expect(actual.facility_layout).not.toBe(payload.effectiveConfig.facility_layout)
    expect(actual.plans[0].rooms.trading.map((room) => room.level)).toEqual(payload.effectiveConfig.trading_station_levels)
    expect(actual.plans[0].rooms.manufacture.map((room) => room.level)).toEqual(payload.effectiveConfig.manufacturing_station_levels)
  })
  it('dispatches schedule payloads without a kind', async () => {
    const port = fakePort()
    const payload = schedulePayload()

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeSchedule).toHaveBeenCalledWith(payload, context)
    expect(port.executeScenarioComparison).not.toHaveBeenCalled()
  })

  it('dispatches scenario comparison payloads explicitly', async () => {
    const port = fakePort()
    const payload = scenarioPayload()

    await executeOptimizationJobWithPort(job(payload), context, port)

    expect(port.executeScenarioComparison).toHaveBeenCalledWith(payload, context)
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

  it('accepts the current generated application build metadata for scenario comparisons', async () => {
    const result = {
      ...scenarioResult(),
      buildMeta: { ...APP_BUILD_META },
    }
    const port = fakePort({ executeScenarioComparison: vi.fn(async () => result) })

    await expect(executeOptimizationJobWithPort(job(scenarioPayload()), context, port))
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
