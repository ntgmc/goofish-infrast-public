const expectedRoutes = [
  '/api/admin/cdk',
  '/api/admin/risk-settings',
  '/api/admin/invitation-settings',
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
  '/api/health',
  '/api/license-status',
  '/api/optimization/jobs',
  '/api/optimization/jobs/:jobId',
  '/api/optimization/reorder-checks',
  '/api/redeem-cdk',
  '/api/user/announcements',
  '/api/user/invitations',
  '/api/user/invitations/code',
  '/api/user/rewards',
  '/api/user/profiles',
  '/api/user/profiles/depot-value',
  '/api/user/profiles/preview',
  '/api/user/profiles/redeem',
  '/api/user/skland/account/select',
  '/api/user/skland/free-preview/account/select',
  '/api/user/skland/free-preview/credential/preview',
  '/api/user/skland/free-preview/login/complete',
  '/api/user/skland/free-preview/login/confirm',
  '/api/user/skland/free-preview/login/start',
  '/api/user/status',
  '/api/user/workspace',
  '/api/user/workspace/free-schedule/confirm',
  '/api/usage-stats',
]

const { getRegisteredApiRoutes } = await import('../server/dist/routes.js')
const actualRoutes = getRegisteredApiRoutes()
const missing = expectedRoutes.filter((route) => !actualRoutes.includes(route))
if (missing.length > 0) {
  throw new Error(`missing server API routes: ${missing.join(', ')}`)
}

const removedRoutes = ['/api/optimize', '/api/optimize/job', '/api/optimize/reorder-check']
const stale = removedRoutes.filter((route) => actualRoutes.includes(route))
if (stale.length > 0) {
  throw new Error(`removed optimize routes are still registered: ${stale.join(', ')}`)
}

console.log(`[check-server-routes] ${actualRoutes.length} API routes registered`)
