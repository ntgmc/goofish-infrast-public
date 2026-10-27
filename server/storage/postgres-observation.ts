import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Pool } from 'pg'
import { getPerformanceContext, logPerformanceEvent, recordPerformanceDuration, withPerformanceContext } from '../performance-observation'

// Preserve pg's callback, promise and synchronous-error contracts at both shared entry points.
function observeCall<T extends (...args: never[]) => unknown>(
  method: T,
  complete: (args: unknown[], durationMs: number, failed: boolean) => void,
): T {
  return new Proxy(method, {
    apply(target, receiver, args: unknown[]) {
      const started = performance.now()
      const correlation = getPerformanceContext()
      let recorded = false
      const finish = (failed: boolean) => {
        if (recorded) return
        recorded = true
        complete(args, performance.now() - started, failed)
      }
      const last = args.at(-1)
      const forwarded = typeof last === 'function'
        ? [...args.slice(0, -1), function (this: unknown, ...result: unknown[]) {
          finish(Boolean(result[0]))
          // pg invokes queued acquisitions in the releasing client's async context.
          return withPerformanceContext(correlation, () => Reflect.apply(last, this, result))
        }]
        : args
      try {
        const result: unknown = Reflect.apply(target, receiver, forwarded)
        if (result instanceof Promise) {
          return result.then((value) => { finish(false); return value }, (error: unknown) => { finish(true); throw error })
        }
        return result
      } catch (error) {
        finish(true)
        throw error
      }
    },
  })
}

export function observePostgresPool(pool: Pool): void {
  const connect = pool.connect
  pool.connect = new Proxy(connect, {
    apply(target, receiver, args: unknown[]) {
      const correlation = getPerformanceContext()
      const waiting = pool.waitingCount
      return Reflect.apply(observeCall(target, (_args, durationMs, failed) => {
        recordPerformanceDuration('postgres.acquire', durationMs, { outcome: failed ? 'error' : 'success' })
        if (failed || durationMs >= 100) logPerformanceEvent('postgres.acquire', {
          duration_ms: durationMs, outcome: failed ? 'error' : 'success',
          waiting_at_start: waiting, waiting: pool.waitingCount, total: pool.totalCount, idle: pool.idleCount,
        }, correlation)
      }), receiver, args)
    },
  })
  pool.on('connect', (client) => {
    const query = client.query
    client.query = new Proxy(query, {
      apply(target, receiver, args: unknown[]) {
        const first = args[0]
        const text = typeof first === 'string' ? first
          : first && typeof first === 'object' && 'text' in first && typeof first.text === 'string' ? first.text : null
        // No streams are used by storage; keep pg's Submittable contract intact.
        if (text === null) return Reflect.apply(target, receiver, args)
        const correlation = getPerformanceContext()
        const operation = /^\s*(select|insert|update|delete|begin|commit|rollback|with)\b/i.exec(text)?.[1]?.toUpperCase() ?? 'OTHER'
        return Reflect.apply(observeCall(target, (_args, durationMs, failed) => {
          recordPerformanceDuration('postgres.query', durationMs, { operation, outcome: failed ? 'error' : 'success' })
          if (failed || durationMs >= 250) logPerformanceEvent('postgres.query', {
            duration_ms: durationMs, operation, outcome: failed ? 'error' : 'success',
            query_fingerprint: createHash('sha256').update(text).digest('hex'),
          }, correlation)
        }), receiver, args)
      },
    })
  })
}
