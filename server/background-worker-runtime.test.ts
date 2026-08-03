import { describe, expect, it, vi } from 'vitest'
import { createBackgroundWorker } from './background-worker-runtime'

describe('background worker runtime', () => {
  it('single-flights concurrent initialization', async () => {
    let release: () => void = () => undefined
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const worker = createBackgroundWorker({ name: 'test_concurrent_initialize', intervalMs: 1_000, run })

    const first = worker.initialize()
    const second = worker.initialize()
    expect(second).toBe(first)
    expect(run).toHaveBeenCalledOnce()
    release()
    await first
    worker.stop()
  })

  it('does not initialize when the required first run fails', async () => {
    const worker = createBackgroundWorker({
      name: 'test_initial_failure',
      intervalMs: 1_000,
      run: vi.fn(async () => { throw new Error('initial failure') }),
    })

    await expect(worker.initialize()).rejects.toThrow('initial failure')
    expect(worker.getHealth()).toMatchObject({
      initialized: false,
      healthy: false,
      consecutive_failures: 1,
    })
  })

  it('uses a slower poll interval after an idle run', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 0)
    const worker = createBackgroundWorker({
      name: 'test_activity_aware_poll',
      intervalMs: 1_000,
      idleIntervalMs: 10_000,
      jitterRatio: 0,
      run,
    })

    try {
      await worker.initialize()
      await vi.advanceTimersByTimeAsync(9_999)
      expect(run).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      worker.stop()
      vi.useRealTimers()
    }
  })

  it('stops scheduling and waits for an in-flight run', async () => {
    vi.useFakeTimers()
    let release: () => void = () => undefined
    let calls = 0
    const worker = createBackgroundWorker({
      name: 'test_idle_drain',
      intervalMs: 1_000,
      jitterRatio: 0,
      run: async () => {
        calls += 1
        if (calls > 1) await new Promise<void>((resolve) => { release = resolve })
      },
    })

    try {
      await worker.initialize()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(worker.getHealth().running).toBe(true)

      worker.stop()
      let drained = false
      const wait = worker.waitForIdle().then(() => { drained = true })
      await Promise.resolve()
      expect(drained).toBe(false)
      release()
      await wait
      expect(worker.getHealth()).toMatchObject({ initialized: false, running: false })
    } finally {
      worker.stop()
      vi.useRealTimers()
    }
  })
})
