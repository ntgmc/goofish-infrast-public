const expectedRoutes = [
  '/api/admin/cdk',
  '/api/admin/risk-settings',
  '/api/admin/invitation-settings',
  '/api/admin/registration-settings',
  '/api/admin/optimization',
  '/api/admin/users',
  '/api/admin/announcement',
  '/api/admin/commercial',
  '/api/admin/usage-stats',
  '/api/announcement',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/change-password',
  '/api/auth/me',
  '/api/auth/register',
  '/api/auth/registration-settings',
  '/api/data',
  '/api/depot-value',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/optimization/jobs',
  '/api/optimization/jobs/:jobId',
  '/api/optimization/jobs/:jobId/cancel',
  '/api/optimization/reorder-checks',
  '/api/user/announcements',
  '/api/user/billing/quote',
  '/api/user/commercial/profiles',
  '/api/user/invitations',
  '/api/user/invitations/code',
  '/api/user/priority-coupon-balance',
  '/api/user/profiles',
  '/api/user/profiles/depot-value',
  '/api/user/profiles/metered-personal',
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

const { getRegisteredApiRoutes, routeRequest } = await import('../server/dist/routes.js')
const actualRoutes = getRegisteredApiRoutes()
const missing = expectedRoutes.filter((route) => !actualRoutes.includes(route))
if (missing.length > 0) {
  throw new Error(`missing server API routes: ${missing.join(', ')}`)
}

const removedRoutes = ['/api/optimize', '/api/optimize/job', '/api/optimize/reorder-check', '/api/user/data/skland/unlink', '/api/user/rewards', '/api/redeem-cdk', '/api/license-status']
const stale = removedRoutes.filter((route) => actualRoutes.includes(route))
if (stale.length > 0) {
  throw new Error(`removed API routes are still registered: ${stale.join(', ')}`)
}

for (const route of ['/api/user/rewards', '/api/redeem-cdk', '/api/license-status']) {
  const response = await routeRequest(new Request(`http://local${route}`, { method: 'POST' }))
  if (response.status !== 404) throw new Error(`removed API route ${route} returned ${response.status} instead of 404`)
}

console.log(`[check-server-routes] ${actualRoutes.length} API routes registered`)
