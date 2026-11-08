import { request } from 'node:http'

const expectedRoutes = [
  '/api/admin/cdk',
  '/api/admin/risk-settings',
  '/api/admin/invitation-settings',
  '/api/admin/registration-settings',
  '/api/admin/optimization',
  '/api/admin/service-status',
  '/api/admin/users',
  '/api/admin/announcement',
  '/api/admin/commercial',
  '/api/admin/usage-stats',
  '/api/announcement',
  '/api/changelog',
  '/api/integrations/qqbot/events',
  '/api/integrations/qqbot/registration-invitations',
  ...['binding', 'account', 'notifications', 'notifications/ack', 'results', 'maa-export', 'reward-items', 'reward-campaigns', 'member-account', 'rewards'].map((path) => `/api/integrations/qqbot/${path}`),
  '/api/user/qqbot',
  '/api/user/qqbot/verification',
  '/api/user/qqbot/activities',
  '/api/integrations/qqbot/verifications',
  '/api/internal/releases/confirm',
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
  '/api/cultivation-plan',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/optimization/jobs',
  '/api/optimization/jobs/:jobId',
  '/api/optimization/jobs/:jobId/cancel',
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
  '/api/user/skland/snapshot',
  '/api/user/skland/snapshot/refresh',
  '/api/user/skland/account/select',
  '/api/user/skland/free-preview/account/select',
  '/api/user/skland/free-preview/credential/preview',
  '/api/user/skland/free-preview/login/complete',
  '/api/user/skland/free-preview/login/confirm',
  '/api/user/skland/free-preview/login/start',
  '/api/user/status',
  '/api/user/workspace',
  '/api/usage-stats',
]

const { getRegisteredApiRoutes, createApiServer } = await import('../server/dist/routes.js')
const actualRoutes = getRegisteredApiRoutes()
const missing = expectedRoutes.filter((route) => !actualRoutes.includes(route))
if (missing.length > 0) {
  throw new Error(`missing server API routes: ${missing.join(', ')}`)
}

const removedRoutes = ['/api/optimize', '/api/optimize/job', '/api/optimize/reorder-check', '/api/optimization/reorder-checks', '/api/user/data/skland/unlink', '/api/user/rewards', '/api/redeem-cdk', '/api/license-status']
const stale = removedRoutes.filter((route) => actualRoutes.includes(route))
if (stale.length > 0) {
  throw new Error(`removed API routes are still registered: ${stale.join(', ')}`)
}

const server = createApiServer()
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  const host = process.env.PUBLIC_APP_URL ? new URL(process.env.PUBLIC_APP_URL).host : 'localhost'
  for (const route of ['/api/optimization/reorder-checks', '/api/user/rewards', '/api/redeem-cdk', '/api/license-status']) {
    const status = await new Promise((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { Host: host } }, (response) => {
        response.resume()
        response.once('error', reject)
        response.once('end', () => resolve(response.statusCode))
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    if (status !== 404) throw new Error(`removed API route ${route} returned ${status} instead of 404`)
  }
} finally {
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

console.log(`[check-server-routes] ${actualRoutes.length} API routes registered`)
