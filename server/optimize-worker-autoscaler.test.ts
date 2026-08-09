import { describe, expect, it, vi } from 'vitest'
import {
  createOptimizeWorkerAutoscaler,
  type OptimizeWorkerAutoscalerOptions,
} from './optimize-worker-autoscaler'
import type { AliyunEcsWorkerStatus } from './aliyun-ecs-worker-controller'
import type { OptimizeQueueLoad } from './storage/optimize-job-store'

const configuration = {
  scaleUpQueueThreshold: 4,
  scaleDownQueueThreshold: 1,
  scaleDownIdleMs: 10 * 60_000,
}

describe('optimization worker autoscaling', () => {
  it('starts a stopped worker only after the queue exceeds the scale-up threshold', async () => {
    const fixture = createFixture({ queued: 4, running: 1, workerInstances: 1 }, 'stopped')
    const autoscaler = createOptimizeWorkerAutoscaler(fixture.options)

    await expect(autoscaler.runOnce()).resolves.toBe('noop')
    expect(fixture.start).not.toHaveBeenCalled()

    fixture.load.queued = 5
    await expect(autoscaler.runOnce()).resolves.toBe('started')
    expect(fixture.start).toHaveBeenCalledOnce()
    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    expect(fixture.start).toHaveBeenCalledOnce()
  })

  it('stops a running worker after ten continuous low-queue minutes', async () => {
    const fixture = createFixture({ queued: 1, running: 0, workerInstances: 2 }, 'running')
    const autoscaler = createOptimizeWorkerAutoscaler(fixture.options)

    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    fixture.nowMs = 10 * 60_000 - 1
    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    expect(fixture.stop).not.toHaveBeenCalled()

    fixture.nowMs = 10 * 60_000
    await expect(autoscaler.runOnce()).resolves.toBe('stopped')
    expect(fixture.stop).toHaveBeenCalledOnce()
  })

  it('resets the idle window when the queue rises above one', async () => {
    const fixture = createFixture({ queued: 1, running: 0, workerInstances: 2 }, 'running')
    const autoscaler = createOptimizeWorkerAutoscaler(fixture.options)

    await autoscaler.runOnce()
    fixture.nowMs = 9 * 60_000
    fixture.load.queued = 2
    await expect(autoscaler.runOnce()).resolves.toBe('noop')
    expect(autoscaler.getLowQueueSince()).toBeNull()

    fixture.nowMs = 10 * 60_000
    fixture.load.queued = 1
    await autoscaler.runOnce()
    fixture.nowMs = 19 * 60_000
    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    expect(fixture.stop).not.toHaveBeenCalled()
  })

  it('waits for running attempts and ECS state transitions before stopping', async () => {
    const fixture = createFixture({ queued: 0, running: 1, workerInstances: 2 }, 'running')
    const autoscaler = createOptimizeWorkerAutoscaler(fixture.options)

    await autoscaler.runOnce()
    fixture.nowMs = 10 * 60_000
    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    expect(fixture.stop).not.toHaveBeenCalled()

    fixture.load.running = 0
    fixture.status = 'stopping'
    await expect(autoscaler.runOnce()).resolves.toBe('waiting')
    expect(fixture.stop).not.toHaveBeenCalled()
  })
})

function createFixture(initialLoad: OptimizeQueueLoad, initialStatus: AliyunEcsWorkerStatus): {
  options: OptimizeWorkerAutoscalerOptions
  load: OptimizeQueueLoad
  status: AliyunEcsWorkerStatus
  nowMs: number
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  const fixture = {
    load: { ...initialLoad },
    status: initialStatus,
    nowMs: 0,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  }
  return Object.assign(fixture, {
    options: {
      worker: {
        getStatus: async () => fixture.status,
        start: fixture.start,
        stop: fixture.stop,
      },
      configuration,
      readQueueLoad: async () => ({ ...fixture.load }),
      now: () => fixture.nowMs,
    },
  })
}
