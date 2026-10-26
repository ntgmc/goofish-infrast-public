import { performance } from 'node:perf_hooks'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDeclaredApiPolicyRoutes } from './security/request-policy'
import { logPerformanceEvent, recordPerformanceDuration } from './performance-observation'

const routes = getDeclaredApiPolicyRoutes()
const exactRoutes = new Set(routes.filter((route) => !route.includes(':')))
const dynamicRoutes = routes.filter((route) => route.includes(':')).map((route) => ({ route, parts: route.split('/') }))

export function observeHttpRequest(req: IncomingMessage, res: ServerResponse, requestId: string): void {
  const started = performance.now()
  let route = 'unmatched'
  try {
    const pathname = new URL(req.url ?? '/', 'http://request.invalid').pathname
    const parts = pathname.split('/')
    route = exactRoutes.has(pathname) ? pathname : dynamicRoutes.find((candidate) => (
      candidate.parts.length === parts.length && candidate.parts.every((part, index) => part.startsWith(':') || part === parts[index])
    ))?.route ?? 'unmatched'
  } catch { /* Keep malformed request targets out of logs. */ }
  const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method ?? '') ? req.method! : 'OTHER'
  const finish = () => {
    res.off('finish', finish)
    res.off('close', finish)
    const durationMs = performance.now() - started
    const outcome = res.writableFinished ? 'completed' : 'aborted'
    recordPerformanceDuration('http.request', durationMs, { method, route, status: res.headersSent ? res.statusCode : 0, outcome })
    logPerformanceEvent('http.request', {
      method, route, status: res.headersSent ? res.statusCode : null, outcome, duration_ms: durationMs,
    }, { request_id: requestId })
  }
  res.once('finish', finish)
  res.once('close', finish)
}
