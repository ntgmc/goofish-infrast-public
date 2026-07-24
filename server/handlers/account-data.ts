import { cancelAccountDeletion, requestAccountDeletion } from '../account-data-lifecycle'
import { getProfileForUser, getProfileWorkspace, getUserById, listProfilesForUser, saveUserProfile } from '../storage/user-store'
import { query } from '../storage/postgres'
import { listPersonalUseDeclarationAcceptancesForUser } from '../storage/personal-use-declaration-store'
import { clearSessionCookie, jsonResponse, normalizeEmail, requireUserSession, type AuthContext } from './user-auth'
import { verifyPasswordHash } from '../security/password'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async function accountDataHandler(req: Request): Promise<Response> {
  const pathname = new URL(req.url).pathname
  if (pathname.endsWith('/cancel')) return handleCancellation(req)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
  if (pathname.endsWith('/export')) return exportData(auth.user.id)
  if (pathname.endsWith('/delete-request')) return requestDeletion(req, auth)
  if (pathname.endsWith('/credential/clear')) return clearCredential(req, auth.user.id)
  return jsonResponse({ error: 'API route not found' }, 404)
}

async function exportData(userId: string): Promise<Response> {
  const profiles = await listProfilesForUser(userId)
  const profileIds = profiles.map((profile) => profile.id)
  const [
    user,
    workspaces,
    usage,
    jobs,
    samples,
    deletion,
    personalUseDeclarations,
    inventoryGrants,
    inventoryConsumptions,
    inventoryLedger,
    inventoryOperations,
    profileEntitlements,
    onboardingTasks,
    distributionRecipients,
    inventoryAdminAudit,
  ] = await Promise.all([
    getUserById(userId),
    Promise.all(profiles.map((profile) => getProfileWorkspace(profile.id))),
    query<{ record_json: unknown }>('select record_json from usage_events where user_id = $1 or profile_id = any($2)', [userId, profileIds]),
    query<{ id: string; status: string; source: string; result_json: unknown; created_at: string; updated_at: string }>('select id, status, source, result_json, created_at, updated_at from optimize_jobs where profile_id = any($1)', [profileIds]),
    query<{ sample_json: unknown; sampled_at: string }>('select sample_json, sampled_at from depot_value_samples where contributor_profile_id = any($1)', [profileIds]),
    query<{ scheduled_for: string; created_at: string }>('select scheduled_for, created_at from account_deletion_requests where user_id = $1', [userId]),
    listPersonalUseDeclarationAcceptancesForUser(userId),
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
    query(`select id, admin_username, action, target_type, target_id, reason, before_json, after_json, created_at
             from inventory_admin_audit
            where target_id = $1 or before_json->>'user_id' = $1 or after_json->>'user_id' = $1
            order by created_at asc`, [userId]),
  ])
  const safeProfiles = profiles.map((profile) => {
    const { skland_binding, skland_pending_binding, ...rest } = profile
    return {
      ...rest,
      skland_binding: skland_binding ? { ...skland_binding, encrypted_cred: undefined } : null,
      skland_pending_binding: skland_pending_binding ? { ...skland_pending_binding, encrypted_cred: undefined } : null,
    }
  })
  const publicUser = user ? { id: user.id, email: user.email, permission: user.permission, status: user.status, created_at: user.created_at, updated_at: user.updated_at } : null
  return new Response(JSON.stringify({
    version: 2,
    exported_at: new Date().toISOString(),
    user: publicUser,
    profiles: safeProfiles,
    workspaces,
    usage_events: usage.rows.map((row) => row.record_json),
    optimize_jobs: jobs.rows,
    depot_samples: samples.rows,
    personal_use_declarations: personalUseDeclarations,
    inventory: {
      grants: inventoryGrants.rows,
      consumptions: inventoryConsumptions.rows,
      ledger: inventoryLedger.rows,
      operations: inventoryOperations.rows,
      profile_entitlements: profileEntitlements.rows,
      onboarding_tasks: onboardingTasks.rows,
      distribution_recipients: distributionRecipients.rows,
      admin_audit_links: inventoryAdminAudit.rows,
    },
    deletion_request: deletion.rows[0] ?? null,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="maa-personal-data.json"', 'Cache-Control': 'no-store' },
  })
}

async function requestDeletion(req: Request, auth: AuthContext) {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.accountDelete)
  if (normalizeEmail(body.email) !== auth.user.email || typeof body.password !== 'string' || !(await verifyPasswordHash(body.password, auth.user)).verified) {
    return jsonResponse({ error: '邮箱或当前密码不正确。' }, 400)
  }
  const request = await requestAccountDeletion(auth.user)
  return jsonResponse({ ok: true, scheduled_for: request.scheduledFor }, 202, { 'Set-Cookie': clearSessionCookie() })
}

async function clearCredential(req: Request, userId: string): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.profileId)
  const profile = typeof body.profile_id === 'string' ? await getProfileForUser(userId, body.profile_id) : null
  if (!profile?.skland_binding) return jsonResponse({ error: '森空岛绑定不存在。' }, 404)
  await saveUserProfile({ ...profile, skland_binding: { ...profile.skland_binding, encrypted_cred: '', credential_status: 'invalid', credential_invalid_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
  return jsonResponse({ ok: true })
}

async function handleCancellation(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await getValidatedJson(req, requestSchemas.deletionToken)
  if (typeof body.token !== 'string' || !(await cancelAccountDeletion(body.token))) return jsonResponse({ error: '注销撤销链接无效或已过期。' }, 400)
  return jsonResponse({ ok: true })
}
