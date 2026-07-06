const expectedRoutes = [
  '/api/admin/cdk',
  '/api/admin/risk-settings',
  '/api/admin/users',
  '/api/admin/announcement',
  '/api/admin/usage-stats',
  '/api/analyze-schedule',
  '/api/announcement',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/change-password',
  '/api/auth/me',
  '/api/auth/register',
  '/api/data',
  '/api/depot-value',
  '/api/free-preview',
  '/api/health',
  '/api/license-status',
  '/api/optimize',
  '/api/redeem-cdk',
  '/api/user/announcements',
  '/api/user/profiles',
  '/api/user/profiles/depot-value',
  '/api/user/profiles/redeem',
  '/api/user/status',
  '/api/user/workspace',
  '/api/usage-stats',
]

const { getRegisteredApiRoutes } = await import('../server/dist/routes.js')
const actualRoutes = getRegisteredApiRoutes()
const missing = expectedRoutes.filter((route) => !actualRoutes.includes(route))
if (missing.length > 0) {
  throw new Error(`missing server API routes: ${missing.join(', ')}`)
}

console.log(`[check-server-routes] ${actualRoutes.length} API routes registered`)
