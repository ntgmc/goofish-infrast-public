import adminCdkHandler from './handlers/admin-cdk'
import adminFeedbackHandler from './handlers/admin-feedback'
import adminOperationAuditHandler from './handlers/admin-operation-audit'
import userFeedbackHandler from './handlers/user-feedback'
import adminRiskSettingsHandler from './handlers/admin-risk-settings'
import adminBehaviorRiskHandler from './handlers/admin-behavior-risk'
import adminInvitationSettingsHandler from './handlers/admin-invitation-settings'
import adminInvitationSettlementsHandler from './handlers/admin-invitation-settlements'
import adminRegistrationSettingsHandler from './handlers/admin-registration-settings'
import adminFeatureSettingsHandler from './handlers/admin-feature-settings'
import adminPublicContentHandler from './handlers/admin-public-content'
import adminPublicContentImageHandler from './handlers/admin-public-content-image'
import sitePublicContentImageHandler from './handlers/site-public-content-image'
import adminRegistrationInvitationsHandler from './handlers/admin-registration-invitations'
import adminOptimizationHandler from './handlers/admin-optimization'
import adminSessionHandler from './handlers/admin-session'
import adminUsersHandler from './handlers/admin-users'
import adminItemsHandler from './handlers/admin-items'
import adminBalanceHandler from './handlers/admin-balance'
import adminCommercialHandler from './handlers/admin-commercial'
import announcementHandler from './handlers/announcement'
import websiteEventsHandler from './handlers/website-events'
import qqBotAccountHandler from './handlers/qqbot-account'
import qqBotRewardsHandler from './handlers/qqbot-rewards'
import userQqBotHandler from './handlers/user-qqbot'
import qqBotVerificationsHandler from './handlers/qqbot-verifications'
import qqBotRegistrationInvitationsHandler from './handlers/qqbot-registration-invitations'
import releaseConfirmationHandler from './handlers/release-confirmation'
import changelogHandler from './handlers/changelog'
import authHandler from './handlers/auth'
import { EFFICIENCY_DATA, EFFICIENCY_DATA_METADATA } from './handlers/data'
import depotValueHandler from './handlers/depot-value'
import cultivationPlanHandler from './handlers/cultivation-plan'
import optimizationHandler from './handlers/optimization'
import userAnnouncementsHandler from './handlers/user-announcements'
import userNotificationsHandler from './handlers/user-notifications'
import userProfilesHandler from './handlers/user-profiles'
import userMeteredProfilesHandler from './handlers/user-metered-profiles'
import userBillingHandler from './handlers/user-billing'
import userSklandHandler from './handlers/user-skland'
import sklandSnapshotHandler from './handlers/skland-snapshot'
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
import serviceStatusHandler from './handlers/service-status'
import adminServiceStatusHandler from './handlers/admin-service-status'
import { checkPostgresHealth, hasDatabaseUrl } from './storage/postgres'
import { getServiceLifecycleState, isServiceReady } from './lifecycle'
import { getAccountDeletionConfigurationHealth } from './account-data-lifecycle'
import { getRuntimeDatabaseSchemaStatus } from './storage/schema'
import { APP_BUILD_META } from '../src/lib/build-meta'

export type ApiHandler = (req: Request) => Response | Promise<Response>

export const API_ROUTES: ReadonlyArray<readonly [path: string, handler: ApiHandler, featureGate?: boolean]> = [
  ['/api/health', handleReadiness, false],
  ['/api/health/live', handleLiveness, false],
  ['/api/health/ready', handleReadiness, false],
  ['/api/data', () => Response.json({ metadata: EFFICIENCY_DATA_METADATA, data: EFFICIENCY_DATA }), false],
  ['/api/user/onboarding-tasks/:code/claim', userInventoryHandler],
  ['/api/user/results/:resultId', userResultsHandler],
  ['/api/optimization/jobs/:jobId', optimizationHandler],
  ['/api/optimization/jobs/:jobId/cancel', optimizationHandler],
  ['/api/cultivation-plan', cultivationPlanHandler],
  ['/api/admin/cdk', adminCdkHandler],
  ['/api/admin/risk-settings', adminRiskSettingsHandler],
  ['/api/admin/behavior-risk', adminBehaviorRiskHandler],
  ['/api/admin/operation-audit', adminOperationAuditHandler],
  ['/api/admin/invitation-settings', adminInvitationSettingsHandler],
  ['/api/admin/invitation-settlements', adminInvitationSettlementsHandler],
  ['/api/admin/registration-settings', adminRegistrationSettingsHandler],
  ['/api/admin/feature-settings', adminFeatureSettingsHandler],
  ['/api/admin/public-content', adminPublicContentHandler],
  ['/api/admin/public-content-image', adminPublicContentImageHandler],
  ['/api/admin/registration-invitations', adminRegistrationInvitationsHandler],
  ['/api/admin/optimization', adminOptimizationHandler],
  ['/api/admin/service-status', adminServiceStatusHandler],
  ['/api/admin/session', adminSessionHandler],
  ['/api/admin/users', adminUsersHandler],
  ['/api/admin/items', adminItemsHandler],
  ['/api/admin/inventory', adminItemsHandler],
  ['/api/admin/balance', adminBalanceHandler],
  ['/api/admin/commercial', adminCommercialHandler],
  ['/api/auth/register', authHandler],
  ['/api/auth/registration-settings', authHandler],
  ['/api/auth/login', authHandler],
  ['/api/auth/logout', authHandler],
  ['/api/auth/forgot-password', authHandler],
  ['/api/auth/reset-password', authHandler],
  ['/api/auth/verify-email', authHandler],
  ['/api/auth/resend-verification', authHandler],
  ['/api/auth/change-password', authHandler],
  ['/api/auth/me', authHandler],
  ['/api/site/features', siteFeaturesHandler],
  ['/api/site/public-content', sitePublicContentHandler],
  ['/api/site/public-content-image', sitePublicContentImageHandler],
  ['/api/changelog', changelogHandler],
  ['/api/status', serviceStatusHandler],
  ['/api/user/data/export', accountDataHandler],
  ['/api/user/data/delete-request', accountDataHandler],
  ['/api/user/data/cancel', accountDataHandler],
  ['/api/user/data/credential/clear', accountDataHandler],
  ['/api/announcement', announcementHandler],
  ['/api/admin/announcement', announcementHandler],
  ['/api/integrations/qqbot/events', websiteEventsHandler],
  ['/api/integrations/qqbot/registration-invitations', qqBotRegistrationInvitationsHandler],
  ...['binding', 'account', 'notifications', 'notifications/ack', 'results', 'maa-export'].map((path) =>
    [`/api/integrations/qqbot/${path}`, qqBotAccountHandler] as [string, ApiHandler]),
  ...['reward-items', 'reward-campaigns', 'member-account', 'rewards'].map((path) =>
    [`/api/integrations/qqbot/${path}`, qqBotRewardsHandler] as [string, ApiHandler]),
  ['/api/user/qqbot', userQqBotHandler],
  ...['/api/user/qqbot/activities', '/api/user/qqbot/verification', '/api/integrations/qqbot/verifications'].map((path) =>
    [path, qqBotVerificationsHandler] as [string, ApiHandler]),
  ['/api/internal/releases/confirm', releaseConfirmationHandler],
  ['/api/usage-stats', usageStatsHandler],
  ['/api/admin/usage-stats', usageStatsHandler],
  ['/api/depot-value', depotValueHandler],
  ['/api/user/announcements', userAnnouncementsHandler],
  ['/api/user/notifications', userNotificationsHandler],
  ['/api/user/feedback', userFeedbackHandler],
  ['/api/admin/feedback', adminFeedbackHandler],
  ['/api/user/profiles', userProfilesHandler],
  ['/api/user/profiles/depot-value', userProfilesHandler],
  ['/api/user/profiles/preview', userProfilesHandler],
  ['/api/user/profiles/redeem', userProfilesHandler],
  ['/api/user/profiles/metered-personal', userMeteredProfilesHandler],
  ['/api/user/commercial/profiles', userMeteredProfilesHandler],
  ['/api/user/billing/quote', userBillingHandler],
  ['/api/user/cdk/redeem', userCdkHandler],
  ['/api/user/skland/login/start', userSklandHandler],
  ['/api/user/skland/login/complete', userSklandHandler],
  ['/api/user/skland/login/confirm', userSklandHandler],
  ['/api/user/skland/pending/cancel', userSklandHandler],
  ['/api/user/skland/credential/preview', userSklandHandler],
  ['/api/user/skland/account/select', userSklandHandler],
  ['/api/user/skland/free-preview/login/start', userSklandHandler],
  ['/api/user/skland/free-preview/login/complete', userSklandHandler],
  ['/api/user/skland/free-preview/login/confirm', userSklandHandler],
  ['/api/user/skland/free-preview/pending/cancel', userSklandHandler],
  ['/api/user/skland/free-preview/credential/preview', userSklandHandler],
  ['/api/user/skland/free-preview/account/select', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/login/start', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/login/complete', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/login/confirm', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/pending/cancel', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/credential/preview', userSklandHandler],
  ['/api/user/skland/lifetime-voucher/account/select', userSklandHandler],
  ['/api/user/skland/snapshot', sklandSnapshotHandler],
  ['/api/user/skland/snapshot/refresh', sklandSnapshotHandler],
  ['/api/user/skland/import/refresh', userSklandHandler],
  ['/api/user/skland/facilities', userSklandHandler],
  ['/api/user/status', userStatusHandler],
  ['/api/user/workspace', userWorkspaceHandler],
  ['/api/user/behavior-risk/engagement', userBehaviorRiskHandler],
  ['/api/user/invitations', userInvitationsHandler],
  ['/api/user/invitations/code', userInvitationsHandler],
  ['/api/user/priority-coupon-balance', userRewardsHandler],
  ['/api/user/inventory', userInventoryHandler],
  ['/api/user/inventory/lifetime-profile', userInventoryHandler],
  ['/api/user/balance', userBalanceHandler],
  ['/api/user/balance/redeem', userBalanceHandler],
  ['/api/user/onboarding-tasks', userInventoryHandler],
  ['/api/user/onboarding-tasks/claim', userInventoryHandler],
  ['/api/user/results', userResultsHandler],
  ['/api/user/maa-export', userResultsHandler],
  ['/api/user/full-result-export', userResultsHandler],
  ['/api/user/result-archive', userResultsHandler],
  ['/api/user/personal-use-declaration', personalUseDeclarationHandler],
  ['/api/optimization/jobs', optimizationHandler],
]

export function getRegisteredApiRoutes(): string[] {
  return API_ROUTES.map(([path]) => path).sort()
}

function handleLiveness(): Response {
  return Response.json({
    ok: true,
    state: getServiceLifecycleState(),
  })
}

async function handleReadiness(): Promise<Response> {
  const state = getServiceLifecycleState()
  if (!isServiceReady()) {
    return Response.json({
      ok: false,
      state,
      build_meta: APP_BUILD_META,
      storage: {
        type: 'postgres',
        ok: false,
      },
    }, { status: 503 })
  }
  const database = await checkPostgresHealth()
  const schema = getRuntimeDatabaseSchemaStatus()
  const accountDeletion = getAccountDeletionConfigurationHealth()
  const storageOk = database.ok && schema !== null
  const ok = hasDatabaseUrl() && storageOk && accountDeletion.ok
  return Response.json(
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
    { status: ok ? 200 : 503 },
  )
}
