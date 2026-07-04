const expectedRoutes = [
  '/api/admin/cdk',
  '/api/admin/users',
  '/api/admin/announcement',
  '/api/admin/usage-stats',
  '/api/analyze-schedule',
  '/api/announcement',
  '/api/data',
  '/api/free-preview',
  '/api/health',
  '/api/license-status',
  '/api/optimize',
  '/api/redeem-cdk',
  '/api/usage-stats',
]

const { getRegisteredApiRoutes } = await import('../server/dist/routes.js')
const actualRoutes = getRegisteredApiRoutes()
const missing = expectedRoutes.filter((route) => !actualRoutes.includes(route))
if (missing.length > 0) {
  throw new Error(`missing server API routes: ${missing.join(', ')}`)
}

console.log(`[check-server-routes] ${actualRoutes.length} API routes registered`)
