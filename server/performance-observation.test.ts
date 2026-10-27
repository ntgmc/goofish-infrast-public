import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushPerformanceDurations, getPerformanceContext, logPerformanceEvent,
  recordPerformanceDuration, startPerformanceObservation, withPerformanceContext,
} from './performance-observation'

afterEach(() => {
  flushPerformanceDurations()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function captureEvents() {
  const events: Array<Record<string, unknown>> = []
  vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
  return events
}

describe('performance observations', () => {
  it('isolates concurrent request contexts and replaces API context in jobs', async () => {
    const events = captureEvents()
    await Promise.all(['request-a', 'request-b'].map((request_id) => withPerformanceContext({ request_id }, async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      logPerformanceEvent('request', {})
      await withPerformanceContext({ job_id: 'job', attempt_no: 2 }, async () => {
        await Promise.resolve()
        logPerformanceEvent('job', {})
      })
      expect(getPerformanceContext()).toEqual({ request_id })
    })))
    expect(events.filter((event) => event.event === 'request').map((event) => event.request_id).sort()).toEqual(['request-a', 'request-b'])
    expect(events.filter((event) => event.event === 'job')).toEqual([
      expect.objectContaining({ job_id: 'job', attempt_no: 2 }), expect.objectContaining({ job_id: 'job', attempt_no: 2 }),
    ])
    expect(events.filter((event) => event.event === 'job').every((event) => !('request_id' in event))).toBe(true)
    expect(getPerformanceContext()).toEqual({})
  })

  it('reports finite distributions once per window without correlation identifiers', () => {
    const events = captureEvents()
    withPerformanceContext({ request_id: 'private-id' }, () => {
      for (const value of [0, 10, 20, 30, 40, NaN, Infinity, -1]) recordPerformanceDuration('http.request', value)
      flushPerformanceDurations()
      flushPerformanceDurations()
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'performance.duration', metric: 'http.request', count: 5 })
    expect(events[0].p50_ms).toBeCloseTo(20, 0)
    expect(events[0].p95_ms).toBeCloseTo(40, 0)
    expect(JSON.stringify(events)).not.toContain('private-id')
  })

  it('keeps short and long samples when histogram capacity grows and starts a fresh window', () => {
    const events = captureEvents()
    const durations = [0, 0.77, 0.77, 2_000, 1_800_000, 7 * 24 * 60 * 60_000]
    for (const duration of durations) recordPerformanceDuration('postgres.query', duration)
    flushPerformanceDurations()
    expect(events[0]).toMatchObject({ count: durations.length })
    expect(Number(events[0].p50_ms)).toBeCloseTo(0.77, 2)
    const expectedMean = durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    expect(Math.abs(Number(events[0].mean_ms) - expectedMean) / expectedMean).toBeLessThan(0.01)
    expect(Number(events[0].max_ms)).toBeGreaterThanOrEqual(durations.at(-1)!)
    expect(Number(events[0].max_ms)).toBeLessThan(durations.at(-1)! * 1.01)
    recordPerformanceDuration('postgres.query', 0.77)
    flushPerformanceDurations()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ count: 1 })
    expect(Number(events[1].max_ms)).toBeCloseTo(0.77, 2)
  })

  it('bounds metric cardinality and keeps overflow samples', () => {
    const events = captureEvents()
    for (let index = 0; index < 520; index += 1) recordPerformanceDuration('http.request', 1, { route: String(index) })
    flushPerformanceDurations()
    expect(events).toHaveLength(513)
    expect(events.reduce((sum, event) => sum + Number(event.count), 0)).toBe(520)
    expect(events.at(-1)).toMatchObject({ labels: { overflow: 'true' }, count: 8 })
  })

  it('samples every five minutes even when idle and flushes exactly once at shutdown', () => {
    const events = captureEvents()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const stop = startPerformanceObservation(() => ({ total: 2, idle: 1, waiting: 3 }))
    vi.advanceTimersByTime(60_000)
    expect(events).toHaveLength(0)
    recordPerformanceDuration('postgres.query', 10)
    vi.advanceTimersByTime(240_000)
    expect(events.filter((event) => event.event === 'performance.runtime')).toHaveLength(1)
    expect(events.filter((event) => event.event === 'performance.duration')).toHaveLength(1)
    recordPerformanceDuration('postgres.query', 20)
    stop()
    stop()
    vi.advanceTimersByTime(300_000)
    expect(events.filter((event) => event.event === 'performance.runtime')).toHaveLength(2)
    expect(events[0]).toMatchObject({ postgres_pool: { total: 2, idle: 1, waiting: 3 }, event_loop_samples: 0, event_loop_p95_ms: null })
    expect(events.filter((event) => event.event === 'performance.duration')).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not propagate logging failures into business operations', () => {
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('logger unavailable') })
    expect(() => logPerformanceEvent('test', {})).not.toThrow()
  })
})
