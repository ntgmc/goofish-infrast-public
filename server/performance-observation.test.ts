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

  it('bounds metric cardinality and keeps overflow samples', () => {
    const events = captureEvents()
    for (let index = 0; index < 520; index += 1) recordPerformanceDuration('http.request', 1, { route: String(index) })
    flushPerformanceDurations()
    expect(events).toHaveLength(513)
    expect(events.reduce((sum, event) => sum + Number(event.count), 0)).toBe(520)
    expect(events.at(-1)).toMatchObject({ labels: { overflow: 'true' }, count: 8 })
  })

  it('samples idle processes and flushes exactly once at shutdown', () => {
    const events = captureEvents()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const stop = startPerformanceObservation(() => ({ total: 2, idle: 1, waiting: 3 }))
    vi.advanceTimersByTime(60_000)
    recordPerformanceDuration('postgres.query', 20)
    stop()
    stop()
    vi.advanceTimersByTime(60_000)
    expect(events.filter((event) => event.event === 'performance.runtime')).toHaveLength(2)
    expect(events[0]).toMatchObject({ postgres_pool: { total: 2, idle: 1, waiting: 3 }, event_loop_samples: 0, event_loop_p95_ms: null })
    expect(events.filter((event) => event.event === 'performance.duration')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not propagate logging failures into business operations', () => {
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('logger unavailable') })
    expect(() => logPerformanceEvent('test', {})).not.toThrow()
  })
})
