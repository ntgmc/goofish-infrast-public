import adminCdkHandler from '../netlify/functions/admin-cdk'
import adminUsersHandler from '../netlify/functions/admin-users'
import analyzeScheduleHandler from '../netlify/functions/analyze-schedule'
import announcementHandler from '../netlify/functions/announcement'
import authHandler from '../netlify/functions/auth'
import { EFFICIENCY_DATA, EFFICIENCY_DATA_METADATA } from '../netlify/functions/data'
import freePreviewHandler from '../netlify/functions/free-preview'
import licenseStatusHandler from '../netlify/functions/license-status'
import optimizeHandler from '../netlify/functions/optimize'
import redeemCdkHandler from '../netlify/functions/redeem-cdk'
import userStatusHandler from '../netlify/functions/user-status'
import userWorkspaceHandler from '../netlify/functions/user-workspace'
import usageStatsHandler from '../netlify/functions/usage-stats'
import { checkPostgresHealth, hasDatabaseUrl } from './storage/postgres'

type ApiHandler = (req: Request, context: unknown) => Promise<Response>

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, X-Admin-User, X-Cdk-Status',
}

const ROUTES = new Map<string, ApiHandler>([
  ['/api/admin/cdk', adminCdkHandler as unknown as ApiHandler],
  ['/api/admin/users', adminUsersHandler as unknown as ApiHandler],
  ['/api/auth/register', authHandler as unknown as ApiHandler],
  ['/api/auth/login', authHandler as unknown as ApiHandler],
  ['/api/auth/logout', authHandler as unknown as ApiHandler],
  ['/api/auth/me', authHandler as unknown as ApiHandler],
  ['/api/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/admin/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/admin/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/analyze-schedule', analyzeScheduleHandler as unknown as ApiHandler],
  ['/api/free-preview', freePreviewHandler as unknown as ApiHandler],
  ['/api/redeem-cdk', redeemCdkHandler as unknown as ApiHandler],
  ['/api/license-status', licenseStatusHandler as unknown as ApiHandler],
  ['/api/user/status', userStatusHandler as unknown as ApiHandler],
  ['/api/user/workspace', userWorkspaceHandler as unknown as ApiHandler],
  ['/api/optimize', optimizeHandler as unknown as ApiHandler],
])

export async function routeRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (url.pathname === '/api/health') return handleHealth()
  if (url.pathname === '/api/data') {
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    return jsonResponse({ metadata: EFFICIENCY_DATA_METADATA, data: EFFICIENCY_DATA })
  }

  const handler = ROUTES.get(url.pathname)
  if (!handler) {
    return jsonResponse({ error: 'API route not found' }, 404)
  }

  return handler(req, {})
}

export function getRegisteredApiRoutes(): string[] {
  return ['/api/health', '/api/data', ...ROUTES.keys()].sort()
}

async function handleHealth(): Promise<Response> {
  const database = await checkPostgresHealth()
  const ok = hasDatabaseUrl() && database.ok
  return jsonResponse(
    {
      ok,
      version: process.env.BACKEND_VERSION || process.env.APP_VERSION || null,
      storage: {
        type: 'postgres',
        configured: hasDatabaseUrl(),
        ok: database.ok,
        error: database.ok ? undefined : database.error,
      },
    },
    ok ? 200 : 503,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      ...CORS_HEADERS,
    },
  })
}
