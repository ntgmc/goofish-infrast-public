import {
  AccountDeletionStateError,
  cancelAccountDeletion,
  requestAccountDeletion,
} from '../account-data-lifecycle'
import {
  getProfileForUser,
  getUserById,
  listProfilesForUser,
  listProfileWorkspaces,
  saveUserProfile,
  toPublicWorkspace,
} from '../storage/user-store'
import { listOptimizationResultsForProfiles } from '../storage/optimization-result-store'
import { query } from '../storage/postgres'
import {
  listPersonalUseDeclarationAcceptancesForUser,
  listPersonalUseDeclarationUsageEventsForUser,
} from '../storage/personal-use-declaration-store'
import { clearSessionCookie, jsonResponse, normalizeEmail, requireUserSession, type AuthContext } from './user-auth'
import { PasswordWorkCapacityError, verifyPasswordHash } from '../security/password'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { normalizeStoredPoints } from '../../src/lib/balance-contracts'
import { exportUserNotifications } from '../storage/notification-store'
import type { PersonalDataExportV4 } from '../../src/lib/types'

const MAX_PERSONAL_DATA_EXPORT_BYTES = 16 * 1024 * 1024
import { PERSONAL_DATA_EXPORT_COVERAGE } from '../personal-data-export'

export default async function accountDataHandler(req: Request): Promise<Response> {
  try {
    const pathname = new URL(req.url).pathname
    if (pathname.endsWith('/cancel')) return await handleCancellation(req)
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。', code: 'authentication_required' }, 401)
    if (pathname.endsWith('/export')) return await exportData(auth.user.id)
    if (pathname.endsWith('/delete-request')) return await requestDeletion(req, auth)
    if (pathname.endsWith('/credential/clear')) return await clearCredential(req, auth.user.id)
    return jsonResponse({ error: 'API route not found', code: 'route_not_found' }, 404)
  } catch (error) {
    if (error instanceof AccountDeletionStateError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof PasswordWorkCapacityError) {
      return jsonResponse(
        {
          error: '密码校验服务繁忙，请稍后重试。',
          code: 'password_service_busy',
          retry_after_seconds: 1,
        },
        429,
        { 'Retry-After': '1', 'Cache-Control': 'no-store' },
      )
    }
    console.warn('[account-data] request failed:', error instanceof Error ? error.name : typeof error)
    return jsonResponse({ error: '账户数据服务暂时不可用，请稍后重试。', code: 'account_data_unavailable' }, 503)
  }
}

async function exportData(userId: string): Promise<Response> {
  const profiles = await listProfilesForUser(userId)
  const profileIds = profiles.map((profile) => profile.id)
  const ownerKeys = profileIds.flatMap((profileId) => [`profile:${profileId}`, `reorder-job:${profileId}`])
  const [
    user,
    workspaceMap,
    optimizationResultsByProfile,
    legacyWorkspace,
    usage,
    jobs,
    jobAttempts,
    jobEffects,
    submissions,
    idempotency,
    samples,
    deletion,
    personalUseDeclarations,
    personalUseUsageEvents,
    invitationCode,
    invitations,
    qqBotRegistration,
    profileEntitlements,
    entitlementLedger,
    meteredPersonalClaim,
    announcementReads,
    inventoryGrants,
    inventoryConsumptions,
    inventoryLedger,
    inventoryOperations,
    profileEntitlementBalances,
    onboardingTasks,
    distributionRecipients,
    balanceAccount,
    balanceTransactions,
    qualificationLedger,
    balanceReservations,
    commercialLimits,
    notifications,
  ] = await Promise.all([
    getUserById(userId),
    listProfileWorkspaces(profileIds),
    listOptimizationResultsForProfiles(profileIds),
    query<{ record_json: Record<string, unknown> }>('select record_json from user_workspaces where user_id = $1', [userId]),
    query<{ record_json: unknown }>(
      'select record_json from usage_events where user_id = $1 or profile_id = any($2::text[])',
      [userId, profileIds],
    ),
    query(
      `select id, status, owner_key, profile_id, billing_user_id, source, result_json,
              error_message, failure_kind, public_error_code, created_at, started_at, finished_at, updated_at
         from optimize_jobs
        where billing_user_id = $1 or profile_id = any($2::text[]) or owner_key = any($3::text[])
        order by created_at asc`,
      [userId, profileIds, ownerKeys],
    ),
    query(
      `select job_id, attempt_no, status, started_at, heartbeat_at, finished_at, failure_kind, error_message
         from optimize_job_attempts
        where job_id in (
          select id from optimize_jobs
           where billing_user_id = $1 or profile_id = any($2::text[]) or owner_key = any($3::text[])
        )
        order by started_at asc, attempt_no asc`,
      [userId, profileIds, ownerKeys],
    ),
    query(
      `select job_id, effect_type, metadata_json, applied_at
         from optimization_job_effects
        where job_id in (
          select id from optimize_jobs
           where billing_user_id = $1 or profile_id = any($2::text[]) or owner_key = any($3::text[])
        )
        order by applied_at asc`,
      [userId, profileIds, ownerKeys],
    ),
    query(
      `select id, owner_key, billing_user_id, created_at
         from optimization_submissions
        where billing_user_id = $1 or owner_key = any($2::text[])
        order by created_at asc`,
      [userId, ownerKeys],
    ),
    query(
      `select owner_key, idempotency_key, request_hash, status, job_id, response_json, created_at, updated_at
         from optimization_idempotency
        where owner_key = any($3::text[])
           or job_id in (
             select id from optimize_jobs
              where billing_user_id = $1 or profile_id = any($2::text[]) or owner_key = any($3::text[])
           )
        order by created_at asc`,
      [userId, profileIds, ownerKeys],
    ),
    query('select sample_json, sampled_at from depot_value_samples where contributor_profile_id = any($1::text[])', [profileIds]),
    query(
      `select scheduled_for, created_at, status
         from account_deletion_requests where user_id = $1`,
      [userId],
    ),
    listPersonalUseDeclarationAcceptancesForUser(userId),
    listPersonalUseDeclarationUsageEventsForUser(userId),
    query('select code, created_at from invitation_codes where user_id = $1', [userId]),
    query(
      `select id,
              case when inviter_user_id = $1 then 'inviter' else 'invitee' end as role,
              invitation_code, status, registered_at, activated_at, settled_at,
              inviter_rewarded_at, settings_snapshot, settlement_json, updated_at
         from invitations
        where inviter_user_id = $1 or invitee_user_id = $1
        order by registered_at asc`,
      [userId],
    ),
    query(
      `select qq_number, created_at, updated_at
         from qqbot_registration_qualifications
        where bound_user_id = $1`,
      [userId],
    ),
    query(
      `select profile_id, first_generated_at, free_revision_count, confirmed_at, locked_at,
              lock_reason, strong_reorder_bonus_month, strong_reorder_bonus_granted_at,
              strong_reorder_bonus_used_at, updated_at
         from profile_entitlements
        where profile_id = any($1::text[])
        order by profile_id`,
      [profileIds],
    ),
    query(
      `select id, profile_id, entitlement_type, status, units, reference_type, reference_id,
              window_key, created_at, settled_at
         from entitlement_ledger
        where profile_id = any($1::text[])
        order by created_at asc`,
      [profileIds],
    ),
    query('select profile_id, claimed_at from metered_personal_claims where user_id = $1', [userId]),
    query(
      'select announcement_id, read_at from user_announcement_reads where user_id = $1 order by read_at asc',
      [userId],
    ),
    query(`select id, reward_type as item_code, source_type, source_id, recipient_role,
                  original_quantity, remaining_quantity, revoked_quantity, validity_days, expires_at,
                  gift_pack_version_id, metadata_json, created_at
             from reward_grants where user_id = $1 order by created_at asc`, [userId]),
    query(`select id, reward_type as item_code, grant_id, reference_type, reference_id, profile_id,
                  status, validity_days, consumed_at, committed_at, refunded_at, refunded_grant_id
             from reward_consumptions where user_id = $1 order by consumed_at asc`, [userId]),
    query(`select id, item_code, event_type, quantity, grant_id, reference_type, reference_id,
                  metadata_json, created_at
             from inventory_ledger where user_id = $1 order by created_at asc`, [userId]),
    query(`select id, operation_type, response_json, created_at, completed_at
             from inventory_operations where user_id = $1 order by created_at asc`, [userId]),
    query(`select profile_id, entitlement_type, units, updated_at
             from profile_entitlement_balances where profile_id = any($1::text[]) order by profile_id, entitlement_type`, [profileIds]),
    query(`select task_code, version_id, completed_at, claimed_at, claim_operation_id
             from user_onboarding_tasks where user_id = $1 order by task_code`, [userId]),
    query(`select recipient.campaign_id, recipient.status, recipient.grant_id, recipient.error_message,
                  recipient.processed_at, campaign.item_code, campaign.quantity, campaign.validity_days,
                  campaign.target_mode, campaign.reason, campaign.created_at
             from inventory_distribution_recipients recipient
             join inventory_distribution_campaigns campaign on campaign.id = recipient.campaign_id
            where recipient.user_id = $1 order by campaign.created_at asc`, [userId]),
    query<{ available: string; reserved: string; lifetime_credited: string; qualification_reversed: string; debt: string }>(
      `select available::text, reserved::text, lifetime_credited::text,
              qualification_reversed::text, debt::text
         from user_balance_accounts where user_id = $1`,
      [userId],
    ),
    query(`select id, kind, amount::text, balance_after::text, reference_type, reference_id, created_at
             from user_balance_transactions where user_id = $1 order by created_at asc, id asc`, [userId]),
    query(`select id, balance_transaction_id, delta::text, reason, created_at
             from user_balance_qualification_ledger where user_id = $1 order by created_at asc`, [userId]),
    query(`select job_id, profile_id, billing_kind, pricing_version, tier, list_price::text,
                  discount_bps, amount::text, status, created_at, settled_at
             from user_balance_reservations where user_id = $1 order by created_at asc`, [userId]),
    query(`select active_profile_limit, total_profile_limit, suspended_at, suspension_reason, updated_at
             from commercial_account_limits where user_id = $1`, [userId]),
    exportUserNotifications(userId),
  ])

  const safeProfiles = profiles.map((profile) => {
    const { skland_binding, skland_pending_binding, ...rest } = profile
    return {
      ...rest,
      skland_binding: skland_binding ? { ...skland_binding, encrypted_cred: undefined } : null,
      skland_pending_binding: skland_pending_binding ? { ...skland_pending_binding, encrypted_cred: undefined } : null,
    }
  })
  const publicUser = user
    ? {
        id: user.id,
        email: user.email,
        permission: user.permission,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
      }
    : null
  const body = {
    version: 4,
    exported_at: new Date().toISOString(),
    coverage: PERSONAL_DATA_EXPORT_COVERAGE,
    user: publicUser,
    profiles: safeProfiles,
    workspaces: profileIds.map((profileId) => {
      const workspace = workspaceMap.get(profileId)
      return workspace ? toPublicWorkspace(workspace) : null
    }),
    optimization_results: profileIds.flatMap((profileId) => optimizationResultsByProfile.get(profileId) ?? []),
    legacy_workspace: legacyWorkspace.rows[0]?.record_json ?? null,
    usage_events: usage.rows.map((row) => row.record_json),
    optimize_jobs: jobs.rows,
    optimize_job_attempts: jobAttempts.rows,
    optimization_job_effects: jobEffects.rows,
    optimization_submissions: submissions.rows,
    optimization_idempotency: idempotency.rows,
    depot_samples: samples.rows,
    invitation_code: invitationCode.rows[0] ?? null,
    invitations: invitations.rows,
    qqbot_registration: qqBotRegistration.rows[0] ?? null,
    profile_entitlements: profileEntitlements.rows,
    entitlement_ledger: entitlementLedger.rows,
    metered_personal_claim: meteredPersonalClaim.rows[0] ?? null,
    announcement_reads: announcementReads.rows,
    personal_use_declarations: personalUseDeclarations,
    personal_use_declaration_usage_events: personalUseUsageEvents,
    inventory: {
      grants: inventoryGrants.rows,
      consumptions: inventoryConsumptions.rows,
      ledger: inventoryLedger.rows,
      operations: inventoryOperations.rows,
      profile_entitlements: profileEntitlementBalances.rows,
      onboarding_tasks: onboardingTasks.rows,
      distribution_recipients: distributionRecipients.rows,
    },
    balance: {
      currency: 'points',
      available: normalizeStoredPoints(balanceAccount.rows[0]?.available ?? '0'),
      reserved: normalizeStoredPoints(balanceAccount.rows[0]?.reserved ?? '0'),
      lifetime_credited: normalizeStoredPoints(balanceAccount.rows[0]?.lifetime_credited ?? '0'),
      qualification_reversed: normalizeStoredPoints(balanceAccount.rows[0]?.qualification_reversed ?? '0'),
      debt: normalizeStoredPoints(balanceAccount.rows[0]?.debt ?? '0'),
      transactions: balanceTransactions.rows.map((transaction) => ({
        ...transaction,
        amount: normalizeStoredPoints((transaction as { amount?: unknown }).amount),
        balance_after: normalizeStoredPoints((transaction as { balance_after?: unknown }).balance_after),
      })),
      qualification_ledger: qualificationLedger.rows,
      reservations: balanceReservations.rows,
    },
    commercial_account: commercialLimits.rows[0] ?? null,
    notifications,
    deletion_request: deletion.rows[0] ?? null,
  } satisfies PersonalDataExportV4

  const serialized = JSON.stringify(body, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PERSONAL_DATA_EXPORT_BYTES) {
    return jsonResponse({
      error: '个人数据导出超过单次下载上限，请联系管理员分批处理。',
      code: 'personal_data_export_too_large',
    }, 413)
  }

  return new Response(serialized, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="maa-personal-data.json"',
      'Cache-Control': 'no-store',
    },
  })
}

async function requestDeletion(req: Request, auth: AuthContext): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.accountDelete)
  if (normalizeEmail(body.email) !== auth.user.email || !(await verifyPasswordHash(body.password, auth.user)).verified) {
    return jsonResponse({ error: '邮箱或当前密码不正确。', code: 'account_confirmation_invalid' }, 400)
  }
  const accepted = await requestAccountDeletion(auth.user)
  return jsonResponse({
    ok: true,
    scheduled_for: accepted.scheduledFor,
    cancellation_email: accepted.cancellationEmail,
  }, 202, { 'Set-Cookie': clearSessionCookie() })
}

async function clearCredential(req: Request, userId: string): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.profileId)
  const profile = await getProfileForUser(userId, body.profile_id)
  if (!profile?.skland_binding) {
    return jsonResponse({ error: '森空岛绑定不存在。', code: 'skland_binding_not_found' }, 404)
  }
  await saveUserProfile({
    ...profile,
    skland_binding: {
      ...profile.skland_binding,
      encrypted_cred: '',
      credential_status: 'invalid',
      credential_invalid_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  })
  return jsonResponse({ ok: true })
}

async function handleCancellation(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.deletionToken)
  if (!(await cancelAccountDeletion(body.token))) {
    return jsonResponse({ error: '注销撤销链接无效或已过期。', code: 'account_deletion_token_invalid' }, 400)
  }
  return jsonResponse({ ok: true })
}
import { Buffer } from 'node:buffer'
