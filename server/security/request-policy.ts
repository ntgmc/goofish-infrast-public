import { z } from 'zod'

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

export const requestSchemas = {
  adminSession: strict({ username: shortString(64), password: shortString(128) }),
  authRegister: strict({
    email: shortString(254),
    password: z.string().min(8).max(128),
    cdk: optionalString(256),
    invite_code: optionalString(128),
  }),
  authLogin: strict({ email: shortString(254), password: z.string().max(128) }),
  authEmail: strict({ email: shortString(254) }),
  authReset: strict({ token: shortString(512), new_password: z.string().min(8).max(128) }),
  authToken: strict({ token: shortString(512) }),
  authChangePassword: strict({
    old_password: z.string().max(128),
    new_password: z.string().min(8).max(128),
  }),
  accountDelete: strict({ email: shortString(254), password: z.string().max(128) }),
  profileId: strict({ profile_id: shortString(128) }),
  deletionToken: strict({ token: shortString(512) }),
  adminCdkCreate: strict({
    permission: optionalString(32),
    order_note: optionalString(500),
    count: z.number().int().min(1).max(100).optional(),
  }),
  adminCdkPatch: strict({
    code_hash: optionalString(64),
    action: optionalString(32),
    permission: optionalString(32),
    order_note: optionalString(500),
    reason: optionalString(500),
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
  }),
  adminRiskSettings: strict({ operator_data_risk_enabled: z.boolean().optional() }),
  adminUserCreate: strict({
    root_password: optionalUnknown,
    username: optionalUnknown,
    password: optionalUnknown,
  }),
  adminUserDelete: strict({ root_password: optionalUnknown, username: optionalUnknown }),
  adminUserPatch: strict({
    action: shortString(64),
    user_id: optionalString(128),
    email: optionalString(254),
    confirm_email: optionalString(254),
    new_password: z.string().max(128).optional(),
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
  analyzeSchedule: strict({
    operators: z.array(z.unknown()).max(2000),
    schedule: z.unknown(),
    config: optionalUnknown,
    ignore_elite: z.boolean().optional(),
  }),
  usageStats: strict({
    event: shortString(64),
    visitor_id: optionalString(128),
    announcement_id: optionalString(120),
    announcement_kind: optionalString(32),
    source: optionalString(120),
  }),
  userAnnouncement: strict({ announcement_id: optionalString(128), all: z.boolean().optional() }),
  profilePreview: strict({ display_name: optionalString(40), note: optionalString(500) }),
  profileRedeem: strict({
    cdk: shortString(256),
    display_name: optionalString(40),
    note: optionalString(500),
    profile_id: optionalString(128),
  }),
  profilePatch: strict({ profile_id: shortString(128), display_name: optionalString(40), note: optionalString(500) }),
  userWorkspace: strict({
    profile_id: shortString(128),
    operators: optionalUnknown,
    config: optionalUnknown,
    elite_overrides: optionalUnknown,
    last_result: optionalUnknown,
    saved_config_action: optionalUnknown,
    result_history_id: optionalString(128),
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
  optimizationJob: strict({
    kind: z.enum(['schedule', 'upgrade_suggestions', 'scenario_comparison']),
    identity: strict({ type: z.literal('profile'), profileId: shortString(128) }),
    operators: z.array(z.unknown()).max(2000),
    config: z.unknown(),
    ignoreElite: z.boolean().optional(),
    includeCurrent: z.boolean().optional(),
    use_priority_coupon: z.boolean().optional(),
    upgradeTaskPayload: optionalUnknown,
    historyResultId: optionalString(128),
    historySource: z.enum(['generated', 'applied_suggestions']).optional(),
    factors: optionalUnknown,
  }),
  reorderCheck: strict({ profileId: shortString(128), config: z.unknown(), baselineHistoryId: optionalString(128) }),
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
}

const ROUTE_POLICIES = new Map<string, RoutePolicy>([
  ['/api/health', route({ GET: none() })],
  ['/api/health/live', route({ GET: none() })],
  ['/api/health/ready', route({ GET: none() })],
  ['/api/data', route({ GET: none() })],
  ['/api/admin/cdk', route({ GET: none(), POST: json('admin', requestSchemas.adminCdkCreate), PATCH: json('admin', requestSchemas.adminCdkPatch), DELETE: json('admin', requestSchemas.adminCdkDelete) }, ['code_hash', 'view', 'permission', 'risk', 'generated', 'status', 'page', 'page_size', 'search'])],
  ['/api/admin/risk-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminRiskSettings), PATCH: json('admin', requestSchemas.adminRiskSettings) })],
  ['/api/admin/invitation-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminInvitationSettings), PATCH: json('admin', requestSchemas.adminInvitationSettings) })],
  ['/api/admin/registration-settings', route({ GET: none(), PUT: json('admin', requestSchemas.adminRegistrationSettings) })],
  ['/api/admin/optimization', route({ GET: none(), POST: json('admin', requestSchemas.adminOptimization) }, ['view', 'status', 'limit', 'id'])],
  ['/api/admin/session', route({ GET: none(), POST: json('auth', requestSchemas.adminSession), DELETE: none() })],
  ['/api/admin/users', route({ GET: none(), POST: json('admin', requestSchemas.adminUserCreate), PATCH: json('admin', requestSchemas.adminUserPatch), DELETE: json('admin', requestSchemas.adminUserDelete) }, ['user_id', 'profile_id', 'include', 'page', 'page_size', 'search'])],
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
  ['/api/user/data/export', route({ GET: none() })],
  ['/api/user/data/delete-request', route({ POST: json('auth', requestSchemas.accountDelete) })],
  ['/api/user/data/cancel', route({ POST: json('auth', requestSchemas.deletionToken) })],
  ['/api/user/data/credential/clear', route({ POST: json('standard', requestSchemas.profileId) })],
  ['/api/user/data/depot-sample/revoke', route({ POST: json('standard', requestSchemas.profileId) })],
  ['/api/announcement', route({ GET: none() }, ['admin'])],
  ['/api/admin/announcement', route({ GET: none(), PUT: json('admin', requestSchemas.announcement) }, ['admin'])],
  ['/api/usage-stats', route({ POST: json('standard', requestSchemas.usageStats) }, ['admin'])],
  ['/api/admin/usage-stats', route({ GET: none() }, ['admin', 'format', 'from', 'to', 'range'])],
  ['/api/analyze-schedule', route({ POST: json('compute', requestSchemas.analyzeSchedule) })],
  ['/api/depot-value', route({ POST: json('depot', z.unknown()) })],
  ['/api/user/announcements', route({ GET: none(), PATCH: json('standard', requestSchemas.userAnnouncement) })],
  ['/api/user/profiles', route({ GET: none(), PATCH: json('standard', requestSchemas.profilePatch) })],
  ['/api/user/profiles/depot-value', route({ POST: none() })],
  ['/api/user/profiles/preview', route({ POST: json('standard', requestSchemas.profilePreview) })],
  ['/api/user/profiles/redeem', route({ POST: json('standard', requestSchemas.profileRedeem) })],
  ['/api/user/status', route({ GET: none() }, ['profile_id'])],
  ['/api/user/workspace', route({ GET: none(), POST: json('compute', requestSchemas.userWorkspace), PATCH: json('compute', requestSchemas.userWorkspace) }, ['profile_id'])],
  ['/api/user/workspace/free-schedule/confirm', route({ POST: json('standard', requestSchemas.userWorkspace) })],
  ['/api/user/invitations', route({ GET: none() })],
  ['/api/user/invitations/code', route({ POST: none() })],
  ['/api/user/rewards', route({ GET: none() })],
  ['/api/optimization/jobs', route({ GET: none(), POST: json('compute', requestSchemas.optimizationJob) }, ['profile_id', 'limit', 'before'])],
  ['/api/optimization/reorder-checks', route({ POST: json('compute', requestSchemas.reorderCheck) })],
  ['/api/user/skland/free-preview/login/start', route({ POST: none() })],
  ...Object.entries(SKLAND_PATHS).map(([path, schema]) => [path, route({ POST: json('credential', schema) })] as [string, RoutePolicy]),
])

export function getRoutePolicy(pathname: string): RoutePolicy | null {
  const exact = ROUTE_POLICIES.get(pathname)
  if (exact) return exact
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
