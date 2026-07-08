import adminCdkHandler from './handlers/admin-cdk'
import adminRiskSettingsHandler from './handlers/admin-risk-settings'
import adminUsersHandler from './handlers/admin-users'
import analyzeScheduleHandler from './handlers/analyze-schedule'
import announcementHandler from './handlers/announcement'
import authHandler from './handlers/auth'
import { EFFICIENCY_DATA, EFFICIENCY_DATA_METADATA } from './handlers/data'
import depotValueHandler from './handlers/depot-value'
import licenseStatusHandler from './handlers/license-status'
import optimizeHandler from './handlers/optimize'
import redeemCdkHandler from './handlers/redeem-cdk'
import userAnnouncementsHandler from './handlers/user-announcements'
import userProfilesHandler from './handlers/user-profiles'
import userSklandHandler from './handlers/user-skland'
import userStatusHandler from './handlers/user-status'
import userWorkspaceHandler from './handlers/user-workspace'
import usageStatsHandler from './handlers/usage-stats'
import { checkPostgresHealth, hasDatabaseUrl } from './storage/postgres'

type ApiHandler = (req: Request) => Promise<Response>

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, X-Admin-User, X-Cdk-Status',
}

const ROUTES = new Map<string, ApiHandler>([
  ['/api/admin/cdk', adminCdkHandler as unknown as ApiHandler],
  ['/api/admin/risk-settings', adminRiskSettingsHandler as unknown as ApiHandler],
  ['/api/admin/users', adminUsersHandler as unknown as ApiHandler],
  ['/api/auth/register', authHandler as unknown as ApiHandler],
  ['/api/auth/login', authHandler as unknown as ApiHandler],
  ['/api/auth/logout', authHandler as unknown as ApiHandler],
  ['/api/auth/forgot-password', authHandler as unknown as ApiHandler],
  ['/api/auth/reset-password', authHandler as unknown as ApiHandler],
  ['/api/auth/change-password', authHandler as unknown as ApiHandler],
  ['/api/auth/me', authHandler as unknown as ApiHandler],
  ['/api/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/admin/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/admin/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/analyze-schedule', analyzeScheduleHandler as unknown as ApiHandler],
  ['/api/depot-value', depotValueHandler as unknown as ApiHandler],
  ['/api/redeem-cdk', redeemCdkHandler as unknown as ApiHandler],
  ['/api/license-status', licenseStatusHandler as unknown as ApiHandler],
  ['/api/user/announcements', userAnnouncementsHandler as unknown as ApiHandler],
  ['/api/user/profiles', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/depot-value', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/preview', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/redeem', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/skland/login/start', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/login/complete', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/login/confirm', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/credential/preview', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/start', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/complete', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/confirm', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/credential/preview', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/import/refresh', userSklandHandler as unknown as ApiHandler],
  ['/api/user/status', userStatusHandler as unknown as ApiHandler],
  ['/api/user/workspace', userWorkspaceHandler as unknown as ApiHandler],
  ['/api/user/workspace/free-schedule/confirm', userWorkspaceHandler as unknown as ApiHandler],
  ['/api/optimize', optimizeHandler as unknown as ApiHandler],
  ['/api/optimize/job', optimizeHandler as unknown as ApiHandler],
  ['/api/optimize/reorder-check', optimizeHandler as unknown as ApiHandler],
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

  return handler(req)
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
