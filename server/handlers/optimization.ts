import {
  getOptimizationJob,
  runReorderCheck,
  submitOptimizationJob,
} from '../optimization/jobs/service'
export { sanitizeConfigForPublicOptimize } from '../optimization/jobs/service'

const JOBS_PATH = '/api/optimization/jobs'
const REORDER_CHECKS_PATH = '/api/optimization/reorder-checks'

export default async function optimizationHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  const pathname = new URL(req.url).pathname
  if (pathname === JOBS_PATH) {
    if (req.method !== 'POST') return methodNotAllowed()
    return submitOptimizationJob(req)
  }
  if (pathname === REORDER_CHECKS_PATH) {
    if (req.method !== 'POST') return methodNotAllowed()
    return runReorderCheck(req)
  }

  const jobId = matchJobId(pathname)
  if (jobId !== null) {
    if (req.method !== 'GET') return methodNotAllowed()
    return getOptimizationJob(req, jobId)
  }

  return jsonError('not_found', 'API route not found', 404)
}

function matchJobId(pathname: string): string | null {
  if (!pathname.startsWith(JOBS_PATH + '/')) return null
  const rawJobId = pathname.slice(JOBS_PATH.length + 1)
  if (!rawJobId || rawJobId.includes('/')) return null
  try {
    return decodeURIComponent(rawJobId)
  } catch {
    return null
  }
}

function methodNotAllowed(): Response {
  return jsonError('method_not_allowed', '方法不允许。', 405)
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
