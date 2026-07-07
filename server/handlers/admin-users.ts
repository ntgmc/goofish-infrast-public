import {
  authenticateAdminRequest,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  requireRootAdminPassword,
} from './admin-auth'
import {
  CDK_PRODUCT_PERMISSIONS,
  getCdkRecordStore,
  jsonResponse,
  type CdkRecord,
} from './license-utils'
import {
  deleteSessionsForUser,
  deleteUserAccount,
  emptyWorkspace,
  getUserByEmail,
  getUserById,
  getProfileById,
  getProfileWorkspace,
  listProfilesForUser,
  listUserAccounts,
  saveProfileWorkspace,
  saveUserProfile,
  saveUserAccount,
  toPublicProfile,
  type UserAccountRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { resetUserPasswordByAdmin } from './user-auth'
import type { ProductPermissionMode } from '../../src/lib/types'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    if (req.method === 'POST') {
      const body = await req.json() as { root_password?: unknown; username?: unknown; password?: unknown }
      if (!(await requireRootAdminPassword(body.root_password))) {
        return jsonResponse({ error: 'Root 口令错误。' }, 401)
      }
      const created = await createAdminUser(body.username, body.password)
      if (!created.ok) return jsonResponse({ error: created.message }, 400)
      return jsonResponse({
        user: {
          username: created.user.username,
          created_at: created.user.created_at,
          updated_at: created.user.updated_at,
        },
      })
    }

    if (req.method === 'GET') {
      if (!(await authenticateAdminRequest(req))) {
        return jsonResponse({ error: '管理账号或密码错误。' }, 401)
      }
      const url = new URL(req.url)
      const userId = url.searchParams.get('user_id')
      const profileId = url.searchParams.get('profile_id')
      if (url.searchParams.get('include') === 'operators') {
        const user = await findTargetUser({ user_id: userId })
        if (!user) return jsonResponse({ error: '用户不存在。' }, 404)
        const profile = await findTargetProfile({ profile_id: profileId }, user)
        if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
        return jsonResponse({ operator_data: await buildAdminProfileOperatorData(user, profile) })
      }
      if (userId) {
        const user = await getUserById(userId)
        if (!user) return jsonResponse({ error: '用户不存在。' }, 404)
        return jsonResponse({ detail: await buildAdminUserDetail(user) })
      }
      const appUsers = await Promise.all((await listUserAccounts()).map(async (user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        permission: user.permission,
        profile_count: (await listProfilesForUser(user.id)).length,
        created_at: user.created_at,
        updated_at: user.updated_at,
      })))
      return jsonResponse({ users: await listAdminUsers(), app_users: appUsers })
    }

    if (req.method === 'PATCH') {
      const body = await req.json() as {
        admin_user?: unknown
        admin_password?: unknown
        action?: unknown
        user_id?: unknown
        email?: unknown
        confirm_email?: unknown
        new_password?: unknown
        profile_id?: unknown
        display_name?: unknown
        note?: unknown
        status?: unknown
        permission?: unknown
      }
      if (!(await authenticateAdminRequest(req, body))) {
        return jsonResponse({ error: '管理账号或密码错误。' }, 401)
      }
      if (
        body.action !== 'reset_password'
        && body.action !== 'freeze_account'
        && body.action !== 'unfreeze_account'
        && body.action !== 'delete_account'
        && body.action !== 'update_profile'
        && body.action !== 'set_profile_status'
        && body.action !== 'set_profile_permission'
        && body.action !== 'clear_profile_skland_binding'
        && body.action !== 'clear_profile_workspace'
      ) {
        return jsonResponse({ error: '未知操作。' }, 400)
      }
      const target = await findTargetUser(body)
      if (!target) return jsonResponse({ error: '用户不存在。' }, 404)

      if (
        body.action === 'update_profile'
        || body.action === 'set_profile_status'
        || body.action === 'set_profile_permission'
        || body.action === 'clear_profile_skland_binding'
        || body.action === 'clear_profile_workspace'
      ) {
        const profile = await findTargetProfile(body, target)
        if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
        if (profile.user_id !== target.id) return jsonResponse({ error: '档案不属于目标用户。' }, 409)

        if (body.action === 'update_profile') {
          const updated = await updateProfileSummary(profile, body.display_name, body.note)
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'set_profile_status') {
          const status = normalizeStatus(body.status)
          if (!status) return jsonResponse({ error: '档案状态必须是 active、frozen 或 revoked。' }, 400)
          const updated = await saveProfilePatch(profile, { status })
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'set_profile_permission') {
          const permission = normalizeProductPermission(body.permission)
          if (!permission) return jsonResponse({ error: '档案权限必须是 recommended、growth、advanced 或 ultimate。' }, 400)
          const updated = await saveProfilePatch(profile, { permission })
          await syncLinkedCdkPermission(updated, permission)
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'clear_profile_skland_binding') {
          const updated = await saveProfilePatch(profile, {
            skland_binding: null,
            skland_pending_binding: null,
            skland_risk: null,
          })
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'clear_profile_workspace') {
          await saveProfileWorkspace(emptyWorkspace(profile.id))
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(profile) })
        }
      }

      if (body.action === 'reset_password') {
        const reset = await resetUserPasswordByAdmin(target, body.new_password)
        if (!reset.ok) return jsonResponse({ error: reset.message }, 400)
        return jsonResponse({ ok: true, user: toAdminAppUser(reset.user), detail: await buildAdminUserDetail(reset.user) })
      }

      if (body.action === 'freeze_account' || body.action === 'unfreeze_account') {
        const status = body.action === 'freeze_account' ? 'frozen' : 'active'
        const updated = await setUserStatus(target, status)
        if (status !== 'active') await deleteSessionsForUser(target.id)
        return jsonResponse({ ok: true, user: toAdminAppUser(updated), detail: await buildAdminUserDetail(updated) })
      }

      if (body.action === 'delete_account') {
        const confirmedEmail = typeof body.confirm_email === 'string'
          ? body.confirm_email.trim().toLowerCase()
          : ''
        if (confirmedEmail !== target.email) {
          return jsonResponse({ error: '确认邮箱不匹配。' }, 400)
        }
        await deleteUserAccount(target.id)
        return jsonResponse({ ok: true, deleted: true, user: { id: target.id, email: target.email } })
      }

      return jsonResponse({ error: '未知操作。' }, 400)
    }

    if (req.method === 'DELETE') {
      const body = await req.json() as { root_password?: unknown; username?: unknown }
      if (!(await requireRootAdminPassword(body.root_password))) {
        return jsonResponse({ error: 'Root 口令错误。' }, 401)
      }
      const deleted = await deleteAdminUser(body.username)
      if (!deleted.ok) return jsonResponse({ error: deleted.message }, 400)
      return jsonResponse({ deleted: true })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('admin users error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function findTargetUser(body: { user_id?: unknown; email?: unknown }): Promise<UserAccountRecord | null> {
  if (typeof body.user_id === 'string' && body.user_id) return getUserById(body.user_id)
  if (typeof body.email === 'string' && body.email.trim()) {
    return getUserByEmail(body.email.trim().toLowerCase())
  }
  return null
}

async function findTargetProfile(body: { profile_id?: unknown }, user: UserAccountRecord): Promise<UserGameAccountRecord | null> {
  if (typeof body.profile_id !== 'string' || !body.profile_id) return null
  const profile = await getProfileById(body.profile_id)
  if (!profile || profile.user_id !== user.id) return null
  return profile
}

async function setUserStatus(
  user: UserAccountRecord,
  status: UserAccountRecord['status'],
): Promise<UserAccountRecord> {
  const updated: UserAccountRecord = {
    ...user,
    status,
    updated_at: new Date().toISOString(),
  }
  await saveUserAccount(updated)
  return updated
}

async function updateProfileSummary(
  profile: UserGameAccountRecord,
  displayNameValue: unknown,
  noteValue: unknown,
): Promise<UserGameAccountRecord> {
  const displayName = normalizeDisplayName(displayNameValue) || profile.display_name || '账号'
  const note = normalizeNote(noteValue)
  return saveProfilePatch(profile, { display_name: displayName, note })
}

async function saveProfilePatch(
  profile: UserGameAccountRecord,
  patch: Partial<UserGameAccountRecord>,
): Promise<UserGameAccountRecord> {
  const updated: UserGameAccountRecord = {
    ...profile,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  await saveUserProfile(updated)
  return updated
}

async function syncLinkedCdkPermission(profile: UserGameAccountRecord, permission: ProductPermissionMode): Promise<void> {
  if (!profile.cdk_key) return
  const store = await getCdkRecordStore()
  const record = await store.get(profile.cdk_key)
  if (!record) return
  await store.set(profile.cdk_key, { ...record, permission })
}

async function buildAdminUserDetail(user: UserAccountRecord) {
  const profiles = await listProfilesForUser(user.id)
  return {
    user: { ...toAdminAppUser(user), profile_count: profiles.length },
    profiles: await Promise.all(profiles.map((profile) => buildAdminProfileSummary(profile))),
  }
}

async function buildAdminProfileSummary(profile: UserGameAccountRecord) {
  const workspace = await getProfileWorkspace(profile.id)
  const cdk = profile.cdk_key ? await (await getCdkRecordStore()).get(profile.cdk_key) : null
  const publicProfile = toPublicProfile(profile, workspace)
  return {
    ...publicProfile,
    note: profile.note,
    skland_binding: profile.skland_binding
      ? {
          uid: profile.skland_binding.uid,
          nickname: profile.skland_binding.nickname,
          channel_name: profile.skland_binding.channel_name,
          bound_at: profile.skland_binding.bound_at,
          last_imported_at: profile.skland_binding.last_imported_at,
        }
      : null,
    skland_pending_binding: profile.skland_pending_binding
      ? {
          uid: profile.skland_pending_binding.uid,
          nickname: profile.skland_pending_binding.nickname,
          channel_name: profile.skland_pending_binding.channel_name,
          operator_count: profile.skland_pending_binding.operator_count,
          created_at: profile.skland_pending_binding.created_at,
          expires_at: profile.skland_pending_binding.expires_at,
        }
      : null,
    skland_risk: profile.skland_risk
      ? {
          uid_mismatch_count: profile.skland_risk.uid_mismatch_count,
          last_mismatch_uid: profile.skland_risk.last_mismatch_uid,
          last_mismatch_nickname: profile.skland_risk.last_mismatch_nickname,
          last_mismatch_at: profile.skland_risk.last_mismatch_at,
        }
      : null,
    workspace: summarizeWorkspace(workspace),
    cdk: summarizeCdkForProfile(cdk),
  }
}

async function buildAdminProfileOperatorData(user: UserAccountRecord, profile: UserGameAccountRecord) {
  const workspace = await getProfileWorkspace(profile.id)
  const operators = Array.isArray(workspace?.operators) ? workspace.operators : []
  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile: {
      id: profile.id,
      display_name: profile.display_name,
      kind: profile.kind === 'depot_value' ? 'depot_value' : 'cdk',
      status: profile.status,
      permission: profile.permission,
      skland_binding: profile.skland_binding
        ? {
            uid: profile.skland_binding.uid,
            nickname: profile.skland_binding.nickname,
            channel_name: profile.skland_binding.channel_name,
            bound_at: profile.skland_binding.bound_at,
            last_imported_at: profile.skland_binding.last_imported_at,
          }
        : null,
      workspace_updated_at: workspace?.updated_at ?? null,
    },
    operators,
    total_operator_records: operators.length,
    owned_operator_count: countOwnedOperators(operators),
    generated_at: new Date().toISOString(),
  }
}

function summarizeWorkspace(workspace: UserWorkspaceRecord | null) {
  const config = workspace?.config
  const result = workspace?.last_result && typeof workspace.last_result === 'object'
    ? workspace.last_result as Record<string, unknown>
    : null
  return {
    exists: Boolean(workspace),
    operator_count: countOwnedOperators(workspace?.operators),
    has_operators: Boolean(workspace?.operators?.length),
    has_config: Boolean(config),
    config_desc: config?.desc || config?.layout || null,
    layout: config?.layout ?? null,
    schedule_mode: String(config?.schedule_mode ?? result?.schedule_mode ?? ''),
    dormitory_rule: config?.dormitory_rule ?? null,
    trading_stations_count: config?.trading_stations_count ?? null,
    manufacturing_stations_count: config?.manufacturing_stations_count ?? null,
    has_last_result: Boolean(result),
    last_result_title: typeof result?.title === 'string' ? result.title : null,
    updated_at: workspace?.updated_at ?? null,
  }
}

function summarizeCdkForProfile(record: CdkRecord | null) {
  if (!record) return null
  return {
    cdk_id: record.code_hash.slice(0, 12),
    permission: record.permission,
    status: record.status,
    license_order_hash: record.license_order_hash,
    order_note: record.order_note,
    operator_count: record.operator_count,
    used_at: record.used_at,
    frozen_at: record.frozen_at ?? null,
    freeze_reason: record.freeze_reason ?? null,
    risk_event_count: record.risk_events?.length ?? 0,
    operator_update_event_count: record.operator_update_events?.length ?? 0,
  }
}

function toAdminAppUser(user: UserAccountRecord) {
  return {
    id: user.id,
    email: user.email,
    permission: user.permission,
    status: user.status,
    cdk_order_hash: user.cdk_order_hash,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }
}

function normalizeProductPermission(value: unknown): ProductPermissionMode | null {
  return typeof value === 'string' && (CDK_PRODUCT_PERMISSIONS as string[]).includes(value)
    ? value as ProductPermissionMode
    : null
}

function normalizeStatus(value: unknown): UserGameAccountRecord['status'] | null {
  return value === 'active' || value === 'frozen' || value === 'revoked' ? value : null
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function countOwnedOperators(operators: UserWorkspaceRecord['operators'] | null | undefined): number {
  return operators?.filter((operator) => operator.own !== false).length ?? 0
}
