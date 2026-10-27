import { AsyncLocalStorage } from 'node:async_hooks'
import { createHistogram, monitorEventLoopDelay, performance, type RecordableHistogram } from 'node:perf_hooks'
import { hostname } from 'node:os'
import { threadId } from 'node:worker_threads'

type PerformanceContext = { request_id?: string; job_id?: string; attempt_no?: number; worker_id?: string }
type Metric = 'http.request' | 'postgres.acquire' | 'postgres.query' | 'optimization.queue' | 'optimization.execution' | 'optimization.stage' | 'optimization.attempt'
type Labels = Record<string, string | number>
const context = new AsyncLocalStorage<PerformanceContext>()
const histograms = new Map<string, { metric: Metric; labels: Labels; histogram: RecordableHistogram; highest: number }>()
const MAX_SERIES = 512

export function withPerformanceContext<T>(value: PerformanceContext, work: () => T): T {
  return context.run(value, work)
}

export function getPerformanceContext(): PerformanceContext {
  return context.getStore() ?? {}
}

export function logPerformanceEvent(event: string, fields: Record<string, unknown>, correlation = getPerformanceContext()): void {
  try {
    console.info(JSON.stringify({
      event, timestamp: new Date().toISOString(), host: hostname(), pid: process.pid,
      thread_id: threadId, role: process.env.APP_ROLE ?? 'api', ...correlation, ...fields,
    }))
  } catch {
    // Observability must not change request or transaction outcomes.
  }
}

export function recordPerformanceDuration(metric: Metric, durationMs: number, labels: Labels = {}): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  const durationUs = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(durationMs * 1e3)))
  let key = JSON.stringify([metric, labels])
  let entry = histograms.get(key)
  if (!entry && histograms.size >= MAX_SERIES) {
    labels = { overflow: 'true' }
    key = JSON.stringify([metric, labels])
    entry = histograms.get(key)
  }
  if (!entry) {
    const highest = Math.max(1_000_000, durationUs)
    entry = { metric, labels, highest, histogram: createHistogram({ figures: 2, highest }) }
    histograms.set(key, entry)
  }
  if (durationUs > entry.highest) {
    const highest = Math.min(Number.MAX_SAFE_INTEGER, Math.max(durationUs, entry.highest * 2))
    const histogram = createHistogram({ figures: 2, highest })
    histogram.add(entry.histogram)
    entry.histogram = histogram
    entry.highest = highest
  }
  entry.histogram.record(durationUs)
}

export function flushPerformanceDurations(): void {
  for (const { metric, labels, histogram } of histograms.values()) {
    logPerformanceEvent('performance.duration', {
      metric, labels, count: histogram.count,
      mean_ms: Math.round(histogram.mean) / 1e3, p50_ms: histogram.percentile(50) / 1e3,
      p95_ms: histogram.percentile(95) / 1e3, max_ms: histogram.max / 1e3,
    }, {})
  }
  histograms.clear()
}

export function startPerformanceObservation(readPool?: () => { total: number; idle: number; waiting: number } | null): () => void {
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()
  let lastTime = performance.now()
  let lastCpu = process.cpuUsage()
  let lastUtilization = performance.eventLoopUtilization()
  const sample = () => {
    const now = performance.now()
    const cpu = process.cpuUsage()
    const utilization = performance.eventLoopUtilization()
    logPerformanceEvent('performance.runtime', {
      interval_ms: now - lastTime,
      cpu_user_ms: (cpu.user - lastCpu.user) / 1000,
      cpu_system_ms: (cpu.system - lastCpu.system) / 1000,
      event_loop_utilization: performance.eventLoopUtilization(utilization, lastUtilization).utilization,
      event_loop_samples: loop.count,
      event_loop_p50_ms: loop.count ? loop.percentile(50) / 1e6 : null,
      event_loop_p95_ms: loop.count ? loop.percentile(95) / 1e6 : null,
      event_loop_max_ms: loop.count ? loop.max / 1e6 : null,
      rss_bytes: process.memoryUsage.rss(),
      postgres_pool: readPool?.() ?? null,
    }, {})
    flushPerformanceDurations()
    loop.reset()
    lastTime = now
    lastCpu = cpu
    lastUtilization = utilization
  }
  const timer = setInterval(sample, 300_000)
  timer.unref()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    sample()
    loop.disable()
  }
}
