import {
  cancelOptimizationJob,
  getOptimizationJob,
  listOptimizationJobs,
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
    if (req.method === 'POST') return submitOptimizationJob(req)
    if (req.method === 'GET') return noStoreResponse(await listOptimizationJobs(req))
    return methodNotAllowed()
  }
  if (pathname === REORDER_CHECKS_PATH) {
    if (req.method !== 'POST') return methodNotAllowed()
    return runReorderCheck(req)
  }

  const jobRoute = matchJobRoute(pathname)
  if (jobRoute !== null) {
    if (jobRoute.action === 'cancel') {
      if (req.method !== 'POST') return methodNotAllowed()
      return noStoreResponse(await cancelOptimizationJob(req, jobRoute.jobId))
    }
    if (req.method !== 'GET') return methodNotAllowed()
    return noStoreResponse(await getOptimizationJob(req, jobRoute.jobId))
  }

  return jsonError('not_found', 'API route not found', 404)
}

export function noStoreResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function matchJobRoute(pathname: string): { jobId: string; action: 'cancel' | null } | null {
  if (!pathname.startsWith(JOBS_PATH + '/')) return null
  const segments = pathname.slice(JOBS_PATH.length + 1).split('/')
  if (!segments[0] || segments.length > 2 || (segments[1] && segments[1] !== 'cancel')) return null
  try {
    return { jobId: decodeURIComponent(segments[0]), action: segments[1] === 'cancel' ? 'cancel' : null }
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
