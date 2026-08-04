import adminCdkHandler from './handlers/admin-cdk'
import adminRiskSettingsHandler from './handlers/admin-risk-settings'
import adminBehaviorRiskHandler from './handlers/admin-behavior-risk'
import adminInvitationSettingsHandler from './handlers/admin-invitation-settings'
import adminInvitationSettlementsHandler from './handlers/admin-invitation-settlements'
import adminRegistrationSettingsHandler from './handlers/admin-registration-settings'
import adminFeatureSettingsHandler from './handlers/admin-feature-settings'
import adminPublicContentHandler from './handlers/admin-public-content'
import adminRegistrationInvitationsHandler from './handlers/admin-registration-invitations'
import adminOptimizationHandler from './handlers/admin-optimization'
import adminSessionHandler from './handlers/admin-session'
import adminUsersHandler from './handlers/admin-users'
import adminItemsHandler from './handlers/admin-items'
import adminBalanceHandler from './handlers/admin-balance'
import adminCommercialHandler from './handlers/admin-commercial'
import announcementHandler from './handlers/announcement'
import websiteEventsHandler from './handlers/website-events'
import releaseConfirmationHandler from './handlers/release-confirmation'
import authHandler from './handlers/auth'
import { EFFICIENCY_DATA, EFFICIENCY_DATA_METADATA } from './handlers/data'
import depotValueHandler from './handlers/depot-value'
import optimizationHandler from './handlers/optimization'
import userAnnouncementsHandler from './handlers/user-announcements'
import userNotificationsHandler from './handlers/user-notifications'
import userProfilesHandler from './handlers/user-profiles'
import userMeteredProfilesHandler from './handlers/user-metered-profiles'
import userBillingHandler from './handlers/user-billing'
import userSklandHandler from './handlers/user-skland'
import userStatusHandler from './handlers/user-status'
import userWorkspaceHandler from './handlers/user-workspace'
import userBehaviorRiskHandler from './handlers/user-behavior-risk'
import userInvitationsHandler from './handlers/user-invitations'
import userRewardsHandler from './handlers/user-rewards'
import userInventoryHandler from './handlers/user-inventory'
import userBalanceHandler from './handlers/user-balance'
import userCdkHandler from './handlers/user-cdk'
import userResultsHandler from './handlers/user-results'
import personalUseDeclarationHandler from './handlers/personal-use-declaration'
import accountDataHandler from './handlers/account-data'
import usageStatsHandler from './handlers/usage-stats'
import siteFeaturesHandler from './handlers/site-features'
import sitePublicContentHandler from './handlers/site-public-content'
import { enforceFeatureGate } from './feature-gate'
import { checkPostgresHealth, hasDatabaseUrl } from './storage/postgres'
import { applyHttpSecurityHeaders, isSecureWebRequest } from './security/http-security'
import { getServiceLifecycleState, isServiceReady } from './lifecycle'
import { getAccountDeletionConfigurationHealth } from './account-data-lifecycle'
import { getRuntimeDatabaseSchemaStatus } from './storage/schema'
import { APP_BUILD_META } from '../src/lib/build-meta'

type ApiHandler = (req: Request) => Promise<Response>

const ROUTES = new Map<string, ApiHandler>([
  ['/api/admin/cdk', adminCdkHandler as unknown as ApiHandler],
  ['/api/admin/risk-settings', adminRiskSettingsHandler as unknown as ApiHandler],
  ['/api/admin/behavior-risk', adminBehaviorRiskHandler as unknown as ApiHandler],
  ['/api/admin/invitation-settings', adminInvitationSettingsHandler as unknown as ApiHandler],
  ['/api/admin/invitation-settlements', adminInvitationSettlementsHandler as unknown as ApiHandler],
  ['/api/admin/registration-settings', adminRegistrationSettingsHandler as unknown as ApiHandler],
  ['/api/admin/feature-settings', adminFeatureSettingsHandler as unknown as ApiHandler],
  ['/api/admin/public-content', adminPublicContentHandler as unknown as ApiHandler],
  ['/api/admin/registration-invitations', adminRegistrationInvitationsHandler as unknown as ApiHandler],
  ['/api/admin/optimization', adminOptimizationHandler as unknown as ApiHandler],
  ['/api/admin/session', adminSessionHandler as unknown as ApiHandler],
  ['/api/admin/users', adminUsersHandler as unknown as ApiHandler],
  ['/api/admin/items', adminItemsHandler as unknown as ApiHandler],
  ['/api/admin/inventory', adminItemsHandler as unknown as ApiHandler],
  ['/api/admin/balance', adminBalanceHandler as unknown as ApiHandler],
  ['/api/admin/commercial', adminCommercialHandler as unknown as ApiHandler],
  ['/api/auth/register', authHandler as unknown as ApiHandler],
  ['/api/auth/registration-settings', authHandler as unknown as ApiHandler],
  ['/api/auth/login', authHandler as unknown as ApiHandler],
  ['/api/auth/logout', authHandler as unknown as ApiHandler],
  ['/api/auth/forgot-password', authHandler as unknown as ApiHandler],
  ['/api/auth/reset-password', authHandler as unknown as ApiHandler],
  ['/api/auth/verify-email', authHandler as unknown as ApiHandler],
  ['/api/auth/resend-verification', authHandler as unknown as ApiHandler],
  ['/api/auth/change-password', authHandler as unknown as ApiHandler],
  ['/api/auth/me', authHandler as unknown as ApiHandler],
  ['/api/site/features', siteFeaturesHandler as unknown as ApiHandler],
  ['/api/site/public-content', sitePublicContentHandler as unknown as ApiHandler],
  ['/api/user/data/export', accountDataHandler as unknown as ApiHandler],
  ['/api/user/data/delete-request', accountDataHandler as unknown as ApiHandler],
  ['/api/user/data/cancel', accountDataHandler as unknown as ApiHandler],
  ['/api/user/data/credential/clear', accountDataHandler as unknown as ApiHandler],
  ['/api/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/admin/announcement', announcementHandler as unknown as ApiHandler],
  ['/api/integrations/qqbot/events', websiteEventsHandler as unknown as ApiHandler],
  ['/api/internal/releases/confirm', releaseConfirmationHandler as unknown as ApiHandler],
  ['/api/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/admin/usage-stats', usageStatsHandler as unknown as ApiHandler],
  ['/api/depot-value', depotValueHandler as unknown as ApiHandler],
  ['/api/user/announcements', userAnnouncementsHandler as unknown as ApiHandler],
  ['/api/user/notifications', userNotificationsHandler as unknown as ApiHandler],
  ['/api/user/profiles', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/depot-value', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/preview', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/redeem', userProfilesHandler as unknown as ApiHandler],
  ['/api/user/profiles/metered-personal', userMeteredProfilesHandler as unknown as ApiHandler],
  ['/api/user/commercial/profiles', userMeteredProfilesHandler as unknown as ApiHandler],
  ['/api/user/billing/quote', userBillingHandler as unknown as ApiHandler],
  ['/api/user/cdk/redeem', userCdkHandler as unknown as ApiHandler],
  ['/api/user/skland/login/start', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/login/complete', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/login/confirm', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/credential/preview', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/account/select', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/start', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/complete', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/login/confirm', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/credential/preview', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/free-preview/account/select', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/lifetime-voucher/login/start', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/lifetime-voucher/login/complete', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/lifetime-voucher/login/confirm', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/lifetime-voucher/credential/preview', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/lifetime-voucher/account/select', userSklandHandler as unknown as ApiHandler],
  ['/api/user/skland/import/refresh', userSklandHandler as unknown as ApiHandler],
  ['/api/user/status', userStatusHandler as unknown as ApiHandler],
  ['/api/user/workspace', userWorkspaceHandler as unknown as ApiHandler],
  ['/api/user/workspace/free-schedule/confirm', userWorkspaceHandler as unknown as ApiHandler],
  ['/api/user/behavior-risk/engagement', userBehaviorRiskHandler as unknown as ApiHandler],
  ['/api/user/invitations', userInvitationsHandler as unknown as ApiHandler],
  ['/api/user/invitations/code', userInvitationsHandler as unknown as ApiHandler],
  ['/api/user/priority-coupon-balance', userRewardsHandler as unknown as ApiHandler],
  ['/api/user/inventory', userInventoryHandler as unknown as ApiHandler],
  ['/api/user/inventory/lifetime-profile', userInventoryHandler as unknown as ApiHandler],
  ['/api/user/balance', userBalanceHandler as unknown as ApiHandler],
  ['/api/user/balance/redeem', userBalanceHandler as unknown as ApiHandler],
  ['/api/user/onboarding-tasks', userInventoryHandler as unknown as ApiHandler],
  ['/api/user/onboarding-tasks/claim', userInventoryHandler as unknown as ApiHandler],
  ['/api/user/results', userResultsHandler as unknown as ApiHandler],
  ['/api/user/maa-export', userResultsHandler as unknown as ApiHandler],
  ['/api/user/full-result-export', userResultsHandler as unknown as ApiHandler],
  ['/api/user/result-archive', userResultsHandler as unknown as ApiHandler],
  ['/api/user/personal-use-declaration', personalUseDeclarationHandler as unknown as ApiHandler],
  ['/api/optimization/jobs', optimizationHandler as unknown as ApiHandler],
  ['/api/optimization/reorder-checks', optimizationHandler as unknown as ApiHandler],
])

export async function routeRequest(req: Request): Promise<Response> {
  const response = await dispatchRequest(req)
  return applyHttpSecurityHeaders(response, isSecureWebRequest(req))
}

async function dispatchRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/api/health/live') return handleLiveness()
  if (url.pathname === '/api/health' || url.pathname === '/api/health/ready') return handleReadiness()
  if (url.pathname === '/api/data') {
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    return jsonResponse({ metadata: EFFICIENCY_DATA_METADATA, data: EFFICIENCY_DATA })
  }

  const handler = /^\/api\/user\/onboarding-tasks\/(welcome_inventory|bind_skland|first_main_schedule)\/claim$/.test(url.pathname)
    ? userInventoryHandler as unknown as ApiHandler
    : url.pathname.startsWith('/api/user/results/')
    ? userResultsHandler as unknown as ApiHandler
    : url.pathname.startsWith('/api/optimization/jobs/')
    ? optimizationHandler as unknown as ApiHandler
    : ROUTES.get(url.pathname)
  if (!handler) {
    return jsonResponse({ error: 'API route not found' }, 404)
  }

  if (!isServiceReady() && url.pathname.startsWith('/api/optimization/')) return handler(req)

  const gated = await enforceFeatureGate(req)
  if (gated) return gated

  return handler(req)
}

export function getRegisteredApiRoutes(): string[] {
  return ['/api/health', '/api/health/live', '/api/health/ready', '/api/data', '/api/user/onboarding-tasks/:code/claim', '/api/user/results/:resultId', '/api/optimization/jobs/:jobId', '/api/optimization/jobs/:jobId/cancel', ...ROUTES.keys()].sort()
}

function handleLiveness(): Response {
  return jsonResponse({
    ok: true,
    state: getServiceLifecycleState(),
  })
}

async function handleReadiness(): Promise<Response> {
  const state = getServiceLifecycleState()
  if (!isServiceReady()) {
    return jsonResponse({
      ok: false,
      state,
      build_meta: APP_BUILD_META,
      storage: {
        type: 'postgres',
        ok: false,
      },
    }, 503)
  }
  const database = await checkPostgresHealth()
  const schema = getRuntimeDatabaseSchemaStatus()
  const accountDeletion = getAccountDeletionConfigurationHealth()
  const storageOk = database.ok && schema !== null
  const ok = hasDatabaseUrl() && storageOk && accountDeletion.ok
  return jsonResponse(
    {
      ok,
      state,
      build_meta: APP_BUILD_META,
      storage: {
        type: 'postgres',
        ok: storageOk,
        schema: schema
          ? {
              ok: true,
              version: schema.version,
              checksum: schema.checksum,
              minimum_app_version: schema.minimumAppVersion,
              validated_at: schema.validatedAt,
            }
          : { ok: false },
      },
      account_deletion: accountDeletion,
    },
    ok ? 200 : 503,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
    },
  })
}
