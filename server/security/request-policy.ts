import { z } from 'zod'
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
} from '../../src/lib/auth-constraints'
import { publicContentDraftSchema } from '../../src/lib/public-content'
import { SITE_FEATURE_KEYS, type SiteFeatureKey } from '../../src/lib/site-features'

export const REQUEST_BODY_LIMITS = Object.freeze({
  none: 0,
  auth: 16 * 1024,
  credential: 32 * 1024,
  standard: 64 * 1024,
  admin: 128 * 1024,
  compute: 256 * 1024,
  depot: 1024 * 1024,
})

export type RequestBodyProfile = keyof typeof REQUEST_BODY_LIMITS
export type RequestMethodPolicy = {
  bodyProfile: RequestBodyProfile
  schema?: z.ZodType
}

export type RoutePolicy = {
  methods: Readonly<Record<string, RequestMethodPolicy>>
  queryKeys: ReadonlySet<string>
}

const shortString = (max = 256) => z.string().min(1).max(max)
const optionalString = (max = 256) => z.string().max(max).optional()
const optionalUnknown = z.unknown().optional()
const strict = z.strictObject

const siteFeatureShape = Object.fromEntries(
  SITE_FEATURE_KEYS.map((key) => [key, z.boolean()]),
) as Record<SiteFeatureKey, z.ZodBoolean>
const siteFeaturesSchema = strict(siteFeatureShape)
const expectedRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const requestSchemas = {
  adminSession: strict({ username: shortString(64), password: shortString(128) }),
  authRegister: strict({
    email: shortString(AUTH_EMAIL_MAX_LENGTH),
    password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH),
    cdk: optionalString(256),
    invite_code: optionalString(128),
  }),
  authLogin: strict({ email: shortString(AUTH_EMAIL_MAX_LENGTH), password: z.string().max(AUTH_PASSWORD_MAX_LENGTH) }),
  authEmail: strict({ email: shortString(AUTH_EMAIL_MAX_LENGTH) }),
  authReset: strict({
    token: shortString(512),
    new_password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH),
  }),
  authToken: strict({ token: shortString(512) }),
  authChangePassword: strict({
    old_password: z.string().max(AUTH_PASSWORD_MAX_LENGTH),
    new_password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH),
  }),
  accountDelete: strict({
    email: z.string().email().max(AUTH_EMAIL_MAX_LENGTH),
    password: z.string().min(1).max(AUTH_PASSWORD_MAX_LENGTH),
  }),
  profileId: strict({ profile_id: shortString(128) }),
  deletionToken: strict({ token: shortString(512) }),
  adminCdkCreate: strict({
    cdk_type: z.enum(['profile', 'balance', 'item']).optional(),
    permission: optionalString(32),
    amount: optionalString(32),
    item_code: z.enum(['lifetime_profile_voucher', 'limited_profile_voucher']).optional(),
    order_note: optionalString(500),
    count: z.number().int().min(1).max(100).optional(),
  }),
  adminCdkPatch: strict({
    code_hash: optionalString(64),
    action: optionalString(64),
    permission: optionalString(32),
    order_note: optionalString(500),
    reason: optionalString(500),
    baseline_source: z.enum(['latest', 'workspace', 'next_import']).optional(),
  }),
  adminCdkDelete: strict({ code_hash: shortString(64) }),
  adminOptimization: strict({ action: shortString(32), id: shortString(128), reason: shortString(500) }),
  adminInvitationSettings: strict({
    enabled: z.boolean().optional(),
    daily_inviter_reward_limit: z.number().int().min(1).max(1000).optional(),
    rewards: z.array(z.unknown()).max(32).optional(),
  }),
  adminRegistrationSettings: strict({
    email_verification_required: z.boolean(),
    invite_code_required: z.boolean(),
    brevo_quota_action: z.enum(['pause_registration', 'allow_unverified_registration']),
    admin_invite_email_reserve: z.number().int().min(0).max(300),
    password_reset_email_reserve: z.number().int().min(0).max(300),
  }),
  adminFeatureSettings: strict({ features: siteFeaturesSchema, expected_revision: expectedRevisionSchema }),
  adminPublicContent: publicContentDraftSchema.extend({ expected_revision: expectedRevisionSchema }),
  adminRegistrationInvitationCreate: strict({}),
  adminRegistrationInvitationPatch: strict({
    invitation_id: shortString(128),
    action: z.literal('revoke'),
  }),
  adminRiskSettings: strict({ operator_data_risk_enabled: z.boolean().optional() }),
  adminBehaviorRiskReview: strict({
    case_id: shortString(128),
    outcome: z.enum(['dismiss', 'restrict']),
    note: shortString(1000),
    members: z.array(strict({
      user_id: shortString(128),
      action: z.enum(['freeze_account', 'freeze_profile']),
      profile_id: optionalString(128),
    })).max(100),
  }),
  adminUserCreate: strict({
    root_password: optionalUnknown,
    username: optionalUnknown,
    password: optionalUnknown,
  }),
  adminUserDelete: strict({ root_password: optionalUnknown, username: optionalUnknown }),
  adminUserPatch: strict({
    action: shortString(64),
    user_id: optionalString(128),
    email: optionalString(AUTH_EMAIL_MAX_LENGTH),
    confirm_email: optionalString(AUTH_EMAIL_MAX_LENGTH),
    new_password: z.string().max(AUTH_PASSWORD_MAX_LENGTH).optional(),
    profile_id: optionalString(128),
    display_name: optionalString(40),
    note: optionalString(500),
    status: optionalString(32),
    permission: optionalString(32),
  }),
  announcement: strict({
    banner: z.unknown().nullable(),
    announcements: z.array(z.unknown()).max(100),
  }),
  usageStats: strict({
    event: shortString(64),
    visitor_id: optionalString(128),
    announcement_id: optionalString(120),
    announcement_kind: optionalString(32),
    source: optionalString(120),
  }),
  userAnnouncement: strict({ announcement_id: optionalString(128), all: z.boolean().optional() }),
  userNotification: z.union([
    strict({ notification_id: shortString(128) }),
    strict({ all: z.literal(true) }),
  ]),
  personalUseDeclarationConfirmation: strict({
    action: z.enum(['free_preview_claim', 'metered_personal_create', 'generated_result_export']),
    profile_id: optionalString(128),
  }),
  profilePreview: strict({ display_name: optionalString(40), note: optionalString(500) }),
  profileRedeem: strict({
    cdk: shortString(256),
    display_name: optionalString(40),
    note: optionalString(500),
    profile_id: optionalString(128),
  }),
  cdkRedeem: strict({
    cdk: shortString(256),
    display_name: optionalString(40),
    note: optionalString(500),
    profile_id: optionalString(128),
    idempotency_key: shortString(200),
  }),
  profilePatch: strict({ profile_id: shortString(128), display_name: optionalString(40), note: optionalString(500) }),
  meteredPersonalProfile: strict({ profile_id: optionalString(128), display_name: optionalString(40), note: optionalString(500) }),
  commercialProfileCreate: strict({ display_name: optionalString(40), note: optionalString(500) }),
  commercialProfilePatch: strict({
    profile_id: shortString(128), action: z.enum(['update', 'archive', 'restore']),
    display_name: optionalString(40), note: optionalString(500),
  }),
  commercialProfileDelete: strict({ profile_id: shortString(128), confirm_permanent_delete: z.literal(true) }),
  userWorkspace: strict({
    profile_id: shortString(128),
    operators: optionalUnknown,
    config: optionalUnknown,
    elite_overrides: optionalUnknown,
    last_result: optionalUnknown,
    saved_config_action: optionalUnknown,
    result_history_id: optionalString(128),
  }),
  behaviorRiskEngagement: strict({
    page_category: z.enum(['landing', 'auth', 'profiles', 'workspace', 'optimizer', 'result', 'account', 'public_info', 'other']),
  }),
  sklandProfile: strict({ profile_id: shortString(128) }),
  sklandScan: strict({ profile_id: shortString(128), scan_id: shortString(256) }),
  sklandCredential: strict({
    profile_id: shortString(128),
    credential_text: z.string().min(1).max(16 * 1024),
    source: z.enum(['manual', 'bookmarklet']).optional(),
  }),
  sklandSelection: strict({ profile_id: shortString(128), selection_id: shortString(256), uid: shortString(128) }),
  sklandConfirmation: strict({ profile_id: shortString(128), confirmation_id: shortString(256) }),
  freePreviewScan: strict({ scan_id: shortString(256) }),
  freePreviewCredential: strict({
    credential_text: z.string().min(1).max(16 * 1024),
    source: z.enum(['manual', 'bookmarklet']).optional(),
    display_name: optionalString(40),
    note: optionalString(500),
  }),
  freePreviewScanComplete: strict({ scan_id: shortString(256), display_name: optionalString(40), note: optionalString(500) }),
  freePreviewSelection: strict({ selection_id: shortString(256), uid: shortString(128) }),
  freePreviewConfirmation: strict({ confirmation_id: shortString(256) }),
  lifetimeVoucherScanComplete: strict({ scan_id: shortString(256) }),
  lifetimeVoucherCredential: strict({
    credential_text: z.string().min(1).max(16 * 1024),
    source: z.enum(['manual', 'bookmarklet']).optional(),
  }),
  lifetimeVoucherSelection: strict({ selection_id: shortString(256), uid: shortString(128) }),
  lifetimeVoucherConfirmation: strict({ confirmation_id: shortString(256), idempotency_key: shortString(200) }),
  lifetimeVoucherProfileCreate: strict({
    idempotency_key: shortString(200),
    display_name: optionalString(40),
    note: optionalString(500),
  }),
  optimizationJob: z.discriminatedUnion('kind', [
    strict({
      kind: z.literal('schedule'),
      identity: strict({ type: z.literal('profile'), profileId: shortString(128) }),
      operators: z.array(z.unknown()).max(2000),
      config: z.unknown(),
      includeUpgradeSuggestions: z.boolean(),
      use_priority_coupon: z.boolean().optional(),
      use_items: z.array(z.enum([
        'priority_compute_coupon', 'reorder_check_coupon', 'scenario_simulation_coupon',
        'training_diagnosis_coupon', 'additional_recompute_coupon', 'plan_capacity_certificate',
        'history_capacity_certificate', 'result_archive_folder', 'maa_export_trial_coupon',
        'newcomer_supply_pack',
      ])).max(3).optional(),
      historySource: z.enum(['generated', 'applied_suggestions']).optional(),
      pricing_version: optionalString(64),
      accepted_max_points: optionalString(32),
    }),
    strict({
      kind: z.literal('scenario_comparison'),
      identity: strict({ type: z.literal('profile'), profileId: shortString(128) }),
      operators: z.array(z.unknown()).max(2000),
      config: z.unknown(),
      factors: optionalUnknown,
      use_items: z.array(z.enum([
        'priority_compute_coupon', 'reorder_check_coupon', 'scenario_simulation_coupon',
        'training_diagnosis_coupon', 'additional_recompute_coupon', 'plan_capacity_certificate',
        'history_capacity_certificate', 'result_archive_folder', 'maa_export_trial_coupon',
        'newcomer_supply_pack',
      ])).max(1).optional(),
    }),
  ]),
  reorderCheck: strict({
    profileId: shortString(128), config: z.unknown(), baselineHistoryId: optionalString(128),
    use_items: z.array(z.literal('reorder_check_coupon')).max(1).optional(),
  }),
  inventoryUse: strict({
    item_code: shortString(128),
    quantity: z.literal(1),
    profile_id: optionalString(128),
    gift_pack_version_id: optionalString(128),
    idempotency_key: shortString(200),
  }),
  balanceRedeem: strict({
    cdk: shortString(256),
    idempotency_key: shortString(200),
  }),
  adminBalanceAdjust: strict({
    user_id: shortString(128),
    operation: z.enum(['credit', 'debit', 'reverse_credit']),
    amount: shortString(32),
    reason: shortString(500),
    idempotency_key: shortString(200),
    original_transaction_id: optionalString(128),
  }),
  adminCommercial: strict({
    user_id: shortString(128),
    active_profile_limit: z.number().int().min(1).max(100000).optional(),
    total_profile_limit: z.number().int().min(1).max(100000).optional(),
    suspended: z.boolean().optional(),
    reason: optionalString(500),
  }),
  onboardingTaskClaim: strict({
    task_code: z.enum(['welcome_inventory', 'bind_skland', 'first_main_schedule']).optional(),
    idempotency_key: shortString(200),
  }),
  maaExport: strict({
    profile_id: shortString(128),
    result_id: shortString(128),
    idempotency_key: shortString(200),
  }),
  fullResultExport: strict({
    profile_id: shortString(128),
    result_id: shortString(128),
    idempotency_key: shortString(200),
  }),
  resultArchive: strict({
    profile_id: shortString(128),
    result_id: shortString(128),
    action: z.enum(['archive', 'unarchive', 'delete']),
    idempotency_key: shortString(200),
  }),
  adminItems: strict({
    action: shortString(64),
    item_code: optionalString(128),
    name: optionalString(80),
    description: optionalString(500),
    icon_key: optionalString(128),
    issuance_enabled: z.boolean().optional(),
    contents: z.array(z.unknown()).max(100).optional(),
    version_id: optionalString(128),
    task_code: z.enum(['welcome_inventory', 'bind_skland', 'first_main_schedule']).optional(),
    enabled: z.boolean().optional(),
    rewards: z.array(z.unknown()).max(100).optional(),
  }),
  adminInventory: strict({
    action: shortString(64),
    root_password: optionalUnknown,
    user_id: optionalString(128),
    user_ids: z.array(shortString(128)).max(10000).optional(),
    campaign_id: optionalString(128),
    grant_id: optionalString(128),
    item_code: optionalString(128),
    gift_pack_version_id: optionalString(128),
    quantity: z.number().int().min(1).max(10000).optional(),
    validity_days: z.number().int().min(0).max(3650).optional(),
    target_mode: z.enum(['user_ids', 'all_users']).optional(),
    reason: optionalString(500),
    confirmation: optionalString(128),
  }),
} as const

const none = (): RequestMethodPolicy => ({ bodyProfile: 'none' })
const json = (bodyProfile: Exclude<RequestBodyProfile, 'none'>, schema: z.ZodType): RequestMethodPolicy => ({ bodyProfile, schema })
const route = (methods: Record<string, RequestMethodPolicy>, queryKeys: string[] = []): RoutePolicy => ({
  methods: Object.freeze(methods),
  queryKeys: new Set(queryKeys),
})

const SKLAND_PATHS: Record<string, z.ZodType> = {
  '/api/user/skland/login/start': requestSchemas.sklandProfile,
  '/api/user/skland/login/complete': requestSchemas.sklandScan,
  '/api/user/skland/login/confirm': requestSchemas.sklandConfirmation,
  '/api/user/skland/credential/preview': requestSchemas.sklandCredential,
  '/api/user/skland/account/select': requestSchemas.sklandSelection,
  '/api/user/skland/import/refresh': requestSchemas.sklandProfile,
  '/api/user/skland/free-preview/login/complete': requestSchemas.freePreviewScanComplete,
  '/api/user/skland/free-preview/login/confirm': requestSchemas.freePreviewConfirmation,
  '/api/user/skland/free-preview/credential/preview': requestSchemas.freePreviewCredential,
  '/api/user/skland/free-preview/account/select': requestSchemas.freePreviewSelection,
  '/api/user/skland/lifetime-voucher/login/complete': requestSchemas.lifetimeVoucherScanComplete,
  '/api/user/skland/lifetime-voucher/login/confirm': requestSchemas.lifetimeVoucherConfirmation,
  '/api/user/skland/lifetime-voucher/credential/preview': requestSchemas.lifetimeVoucherCredential,
  '/api/user/skland/lifetime-voucher/account/select': requestSchemas.lifetimeVoucherSelection,
}

const ROUTE_POLICIES = new Map<string, RoutePolicy>([
  ['/api/health', route({ GET: none() })],
  ['/api/health/live', route({ GET: none() })],
  ['/api/health/ready', route({ GET: none() })],
  ['/api/data', route({ GET: none() })],
  ['/api/admin/cdk', route({ GET: none(), POST: json('admin', requestSchemas.adminCdkCreate), PATCH: json('admin', requestSchemas.adminCdkPatch), DELETE: json('admin', requestSchemas.adminCdkDelete) }, ['code_hash', 'view', 'permission', 'cdk_type', 'risk', 'generated', 'status', 'page', 'page_size', 'search'])],
  ['/api/admin/risk-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminRiskSettings), PATCH: json('admin', requestSchemas.adminRiskSettings) })],
  ['/api/admin/behavior-risk', route({ GET: none(), POST: json('admin', requestSchemas.adminBehaviorRiskReview) }, ['status', 'page', 'page_size'])],
  ['/api/admin/invitation-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminInvitationSettings), PATCH: json('admin', requestSchemas.adminInvitationSettings) })],
  ['/api/admin/registration-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminRegistrationSettings) })],
  ['/api/admin/feature-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminFeatureSettings) })],
  ['/api/admin/public-content', route({ GET: none(), PUT: json('admin', requestSchemas.adminPublicContent) })],
  ['/api/admin/registration-invitations', route({
    GET: none(),
    POST: json('admin', requestSchemas.adminRegistrationInvitationCreate),
    PATCH: json('admin', requestSchemas.adminRegistrationInvitationPatch),
  }, ['page', 'page_size', 'status'])],
  ['/api/admin/optimization', route({ GET: none(), POST: json('admin', requestSchemas.adminOptimization) }, ['view', 'status', 'limit', 'id'])],
  ['/api/admin/session', route({ GET: none(), POST: json('auth', requestSchemas.adminSession), DELETE: none() })],
  ['/api/admin/users', route({ GET: none(), POST: json('admin', requestSchemas.adminUserCreate), PATCH: json('admin', requestSchemas.adminUserPatch), DELETE: json('admin', requestSchemas.adminUserDelete) }, ['user_id', 'profile_id', 'include', 'page', 'page_size', 'search'])],
  ['/api/admin/balance', route({ GET: none(), POST: json('admin', requestSchemas.adminBalanceAdjust) }, ['user_id', 'cursor', 'limit'])],
  ['/api/admin/commercial', route({ GET: none(), POST: json('admin', requestSchemas.adminCommercial) }, ['user_id', 'summary'])],
  ['/api/auth/register', route({ POST: json('auth', requestSchemas.authRegister) })],
  ['/api/auth/registration-settings', route({ GET: none() })],
  ['/api/auth/login', route({ POST: json('auth', requestSchemas.authLogin) })],
  ['/api/auth/logout', route({ POST: none() })],
  ['/api/auth/forgot-password', route({ POST: json('auth', requestSchemas.authEmail) })],
  ['/api/auth/reset-password', route({ POST: json('auth', requestSchemas.authReset) })],
  ['/api/auth/verify-email', route({ POST: json('auth', requestSchemas.authToken) })],
  ['/api/auth/resend-verification', route({ POST: json('auth', requestSchemas.authEmail) })],
  ['/api/auth/change-password', route({ POST: json('auth', requestSchemas.authChangePassword) })],
  ['/api/auth/me', route({ GET: none() }, ['profile_id'])],
  ['/api/site/features', route({ GET: none() })],
  ['/api/site/public-content', route({ GET: none() })],
  ['/api/user/data/export', route({ GET: none() })],
  ['/api/user/data/delete-request', route({ POST: json('auth', requestSchemas.accountDelete) })],
  ['/api/user/data/cancel', route({ POST: json('auth', requestSchemas.deletionToken) })],
  ['/api/user/data/credential/clear', route({ POST: json('standard', requestSchemas.profileId) })],
  ['/api/announcement', route({ GET: none() }, ['admin'])],
  ['/api/admin/announcement', route({ GET: none(), PUT: json('admin', requestSchemas.announcement) }, ['admin'])],
  ['/api/usage-stats', route({ POST: json('standard', requestSchemas.usageStats) }, ['admin'])],
  ['/api/admin/usage-stats', route({ GET: none() }, ['admin', 'format', 'from', 'to', 'range'])],
  ['/api/depot-value', route({ POST: json('depot', z.unknown()) })],
  ['/api/user/announcements', route({ GET: none(), PATCH: json('standard', requestSchemas.userAnnouncement) })],
  ['/api/user/notifications', route({ GET: none(), PATCH: json('standard', requestSchemas.userNotification) }, ['cursor', 'limit'])],
  ['/api/user/profiles', route({ GET: none(), PATCH: json('standard', requestSchemas.profilePatch) })],
  ['/api/user/profiles/depot-value', route({ POST: none() })],
  ['/api/user/profiles/preview', route({ POST: json('standard', requestSchemas.profilePreview) })],
  ['/api/user/profiles/redeem', route({ POST: json('standard', requestSchemas.profileRedeem) })],
  ['/api/user/profiles/metered-personal', route({ POST: json('standard', requestSchemas.meteredPersonalProfile) })],
  ['/api/user/commercial/profiles', route({
    GET: none(), POST: json('standard', requestSchemas.commercialProfileCreate),
    PATCH: json('standard', requestSchemas.commercialProfilePatch),
    DELETE: json('standard', requestSchemas.commercialProfileDelete),
  }, ['state', 'q', 'cursor', 'limit'])],
  ['/api/user/billing/quote', route({ GET: none() }, ['profile_id', 'operation'])],
  ['/api/user/status', route({ GET: none() }, ['profile_id'])],
  ['/api/user/workspace', route({ GET: none(), POST: json('compute', requestSchemas.userWorkspace), PATCH: json('compute', requestSchemas.userWorkspace) }, ['profile_id'])],
  ['/api/user/workspace/free-schedule/confirm', route({ POST: json('standard', requestSchemas.userWorkspace) })],
  ['/api/user/behavior-risk/engagement', route({ POST: json('standard', requestSchemas.behaviorRiskEngagement) })],
  ['/api/user/invitations', route({ GET: none() }, ['cursor', 'limit'])],
  ['/api/user/invitations/code', route({ POST: none() })],
  ['/api/user/rewards', route({ GET: none() })],
  ['/api/user/inventory', route({ GET: none(), POST: json('standard', requestSchemas.inventoryUse) })],
  ['/api/user/inventory/lifetime-profile', route({ POST: json('standard', requestSchemas.lifetimeVoucherProfileCreate) })],
  ['/api/user/cdk/redeem', route({ POST: json('standard', requestSchemas.cdkRedeem) })],
  ['/api/user/balance', route({ GET: none() }, ['cursor', 'limit'])],
  ['/api/user/balance/redeem', route({ POST: json('standard', requestSchemas.balanceRedeem) })],
  ['/api/user/onboarding-tasks', route({ GET: none() })],
  ['/api/user/onboarding-tasks/claim', route({ POST: json('standard', requestSchemas.onboardingTaskClaim) })],
  ['/api/user/maa-export', route({ POST: json('standard', requestSchemas.maaExport) })],
  ['/api/user/full-result-export', route({ POST: json('standard', requestSchemas.fullResultExport) })],
  ['/api/user/result-archive', route({ POST: json('standard', requestSchemas.resultArchive) })],
  ['/api/admin/items', route({ GET: none(), POST: json('admin', requestSchemas.adminItems), PATCH: json('admin', requestSchemas.adminItems) })],
  ['/api/admin/inventory', route({ GET: none(), POST: json('admin', requestSchemas.adminInventory), PATCH: json('admin', requestSchemas.adminInventory) }, ['campaign_id'])],
  ['/api/user/personal-use-declaration', route({ GET: none(), POST: json('standard', requestSchemas.personalUseDeclarationConfirmation) }, ['profile_id'])],
  ['/api/optimization/jobs', route({ GET: none(), POST: json('compute', requestSchemas.optimizationJob) }, ['profile_id', 'limit', 'before'])],
  ['/api/optimization/reorder-checks', route({ POST: json('compute', requestSchemas.reorderCheck) })],
  ['/api/user/skland/free-preview/login/start', route({ POST: none() })],
  ['/api/user/skland/lifetime-voucher/login/start', route({ POST: none() })],
  ...Object.entries(SKLAND_PATHS).map(([path, schema]) => [path, route({ POST: json('credential', schema) })] as [string, RoutePolicy]),
])

export function getRoutePolicy(pathname: string): RoutePolicy | null {
  const exact = ROUTE_POLICIES.get(pathname)
  if (exact) return exact
  if (/^\/api\/user\/onboarding-tasks\/(welcome_inventory|bind_skland|first_main_schedule)\/claim$/.test(pathname)) {
    return route({ POST: json('standard', requestSchemas.onboardingTaskClaim) })
  }
  if (!pathname.startsWith('/api/optimization/jobs/')) return null
  const suffix = pathname.slice('/api/optimization/jobs/'.length)
  const segments = suffix.split('/')
  if (!segments[0] || segments.length > 2 || (segments[1] && segments[1] !== 'cancel')) return null
  try {
    const jobId = decodeURIComponent(segments[0])
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return null
  } catch {
    return null
  }
  return segments[1] === 'cancel' ? route({ POST: none() }) : route({ GET: none() })
}

export function getAllowedMethods(policy: RoutePolicy): string[] {
  return Object.keys(policy.methods).sort()
}
