import { randomUUID } from 'node:crypto'
import {
  authenticateAdminRequest,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  requireRootAdminPassword,
} from './admin-auth'
import { PasswordWorkCapacityError } from '../security/password'
import {
  CDK_PRODUCT_PERMISSIONS,
  getCdkRecordStore,
  jsonResponse,
  type CdkRecord,
} from './license-utils'
import {
  deleteUserAccount,
  emptyWorkspace,
  getUserByEmail,
  getUserById,
  getProfileById,
  getProfileWorkspace,
  isFreePreviewProfile,
  listProfilesForUser,
  listProfileWorkspaces,
  listAdminUserAccountsPage,
  normalizeProfileKind,
  saveUserProfileByAdmin,
  saveUserAccountByAdmin,
  toPublicProfile,
  type UserAccountRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
  AdminProfileMutationConflictError,
} from '../storage/user-store'
import {
  AdminPaginationError,
  buildAdminPagination,
  parseAdminPageRequest,
  parseAdminProfilePageRequest,
  type AdminProfilePageRequest,
} from './admin-pagination'
import { resetUserPasswordByAdmin } from './user-auth'
import type { AdminUserWorkspaceExportV1, ProductPermissionMode } from '../../src/lib/types'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import {
  listPersonalUseDeclarationAcceptancesForUser,
  listPersonalUseDeclarationUsageEventsForUser,
} from '../storage/personal-use-declaration-store'
import { recordAccountDeletedBehaviorEvent } from '../behavior-risk/service'
import { getRequestClientIp } from '../security/client-ip'
import { recordAdminOperationAudit } from '../storage/admin-operation-audit-store'
import { listCdkRecordsByKeys } from '../storage/cdk-store'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.adminUserCreate)
      const existingAdmins = await listAdminUsers()
      const currentAdmin = existingAdmins.length === 0
        ? null
        : await authenticateAdminRequest(req, { capability: 'admin_manage', requireRecentLogin: true })
      if (currentAdmin && !currentAdmin.ok) return currentAdmin.response
      const rootAuthentication = await requireRootAdminPassword(req, body.root_password)
      if (!rootAuthentication.ok) return rootAuthentication.response
      const auditContext = buildAdminAuditContext(
        req,
        currentAdmin?.ok ? currentAdmin.username : rootAuthentication.username,
        body.reason,
      )
      const created = await createAdminUser(
        body.username,
        body.password,
        body.role,
        body.replace_existing === true,
        auditContext,
      )
      if (!created.ok) return jsonResponse({ error: created.message, code: created.code }, created.code === 'already_exists' ? 409 : 400)
      return jsonResponse({
        user: {
          username: created.user.username,
          role: created.user.role,
          created_at: created.user.created_at,
          updated_at: created.user.updated_at,
        },
        replaced: created.replaced,
      })
    }

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const userId = url.searchParams.get('user_id')
      const profileId = url.searchParams.get('profile_id')
      const include = url.searchParams.get('include')
      const authentication = await authenticateAdminRequest(
        req,
        include === 'workspaces' || include === 'operators' || Boolean(userId)
          ? 'sensitive_data_view'
          : 'user_view',
      )
      if (!authentication.ok) return authentication.response
      if (include === 'workspaces') {
        const user = await findTargetUser({ user_id: userId })
        if (!user) return jsonResponse({ error: '用户不存在。' }, 404)
        await auditOperation(req, {
          actorUsername: authentication.username,
          action: 'user_workspace.export',
          targetType: 'user',
          targetId: user.id,
          reason: '管理员导出用户工作区数据。',
        })
        return exportAdminUserWorkspaces(user)
      }
      if (include === 'operators') {
        const user = await findTargetUser({ user_id: userId })
        if (!user) return jsonResponse({ error: '用户不存在。' }, 404)
        const profile = await findTargetProfile({ profile_id: profileId }, user)
        if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
        await auditOperation(req, {
          actorUsername: authentication.username,
          action: 'profile_operators.view',
          targetType: 'profile',
          targetId: profile.id,
          reason: '管理员查看完整干员数据。',
        })
        return jsonResponse({ operator_data: await buildAdminProfileOperatorData(user, profile) })
      }
      if (userId) {
        const user = await getUserById(userId)
        if (!user) return jsonResponse({ error: '用户不存在。' }, 404)
        const profilePage = parseAdminProfilePageRequest(url)
        await auditOperation(req, {
          actorUsername: authentication.username,
          action: 'user_sensitive_detail.view',
          targetType: 'user',
          targetId: user.id,
          reason: '管理员查看用户敏感详情。',
        })
        return jsonResponse({ detail: await buildAdminUserDetail(user, profilePage) })
      }
      const request = parseAdminPageRequest(url)
      const result = await listAdminUserAccountsPage(request)
      const profilesByUser = new Map<string, UserGameAccountRecord[]>()
      for (const profile of result.profiles) {
        const profiles = profilesByUser.get(profile.user_id) ?? []
        profiles.push(profile)
        profilesByUser.set(profile.user_id, profiles)
      }
      const appUsers = result.users.map((user) => {
        const profiles = profilesByUser.get(user.id) ?? []
        return { ...toAdminAppUser(user, profiles), profile_count: profiles.length }
      })
      return jsonResponse({
        users: await listAdminUsers(),
        app_users: appUsers,
        pagination: buildAdminPagination(result.page, request.pageSize, result.total),
      })
    }

    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.adminUserPatch)
      const authentication = await authenticateAdminRequest(req, adminUserActionRequirement(body.action))
      if (!authentication.ok) return authentication.response
      const target = await findTargetUser(body)
      if (!target) return jsonResponse({ error: '用户不存在。' }, 404)

      if (
        body.action === 'update_profile'
        || body.action === 'set_profile_status'
        || body.action === 'set_profile_permission'
        || body.action === 'upgrade_preview_profile'
        || body.action === 'clear_profile_skland_binding'
        || body.action === 'clear_profile_workspace'
      ) {
        const profile = await findTargetProfile(body, target)
        if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
        if (profile.user_id !== target.id) return jsonResponse({ error: '档案不属于目标用户。' }, 409)
        if (body.expected_updated_at !== profile.updated_at) {
          return jsonResponse({ error: '账号档案已被其他请求修改，请刷新后重试。' }, 409)
        }

        if (body.action === 'update_profile') {
          const updated = await updateProfileSummary(
            profile,
            body.display_name,
            body.note,
            profileMutationContext(req, authentication.username, body.action, body.reason),
          )
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'set_profile_status') {
          const status = normalizeStatus(body.status)
          if (!status) return jsonResponse({ error: '档案状态必须是 active、frozen 或 revoked。' }, 400)
          const updated = await saveProfilePatch(
            profile,
            { status },
            profileMutationContext(req, authentication.username, body.action, body.reason),
          )
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'set_profile_permission') {
          const permission = normalizeProductPermission(body.permission)
          if (!permission) return jsonResponse({ error: '档案权限必须是 recommended、growth、advanced 或 ultimate。' }, 400)
          const updated = await saveProfilePatch(
            profile,
            { permission },
            profileMutationContext(req, authentication.username, body.action, body.reason, {
              linkedCdkPermission: permission,
            }),
          )
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'upgrade_preview_profile') {
          if (!isFreePreviewProfile(profile)) {
            return jsonResponse({ error: '只有免费预览档案可以免 CDK 升级。' }, 409)
          }
          const permission = normalizeProductPermission(body.permission)
          if (!permission) return jsonResponse({ error: '档案权限必须是 recommended、growth、advanced 或 ultimate。' }, 400)
          const updated = await saveProfilePatch(profile, {
            kind: 'cdk',
            permission,
            cdk_key: null,
            cdk_code_hash: null,
            cdk_order_hash: null,
          }, profileMutationContext(req, authentication.username, body.action, body.reason))
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'clear_profile_skland_binding') {
          const updated = await saveProfilePatch(profile, {
            skland_binding: null,
            skland_pending_binding: null,
            skland_risk: null,
          }, profileMutationContext(req, authentication.username, body.action, body.reason, {
            resetLinkedCdkOperatorBaselineReason: '管理员清除森空岛绑定，等待下次有效导入建立新干员基线。',
          }))
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }

        if (body.action === 'clear_profile_workspace') {
          const updated = await saveProfilePatch(
            profile,
            {},
            profileMutationContext(req, authentication.username, body.action, body.reason, {
              workspace: emptyWorkspace(profile.id),
              expectedWorkspaceUpdatedAt: body.expected_workspace_updated_at,
            }),
          )
          return jsonResponse({ ok: true, detail: await buildAdminUserDetail(target), profile: await buildAdminProfileSummary(updated) })
        }
      }

      if (body.action === 'reset_password') {
        const reset = await resetUserPasswordByAdmin(target, body.new_password, buildAuditOperationInput(req, {
          actorUsername: authentication.username,
          action: 'user.reset_password',
          targetType: 'user',
          targetId: target.id,
          reason: body.reason,
          before: userAuditSnapshot(target),
        }))
        if (!reset.ok) {
          return jsonResponse({ error: reset.message, ...(reset.code && { code: reset.code }) }, reset.status)
        }
        return jsonResponse({ ok: true, user: toAdminAppUser(reset.user), detail: await buildAdminUserDetail(reset.user) })
      }

      if (body.action === 'freeze_account' || body.action === 'unfreeze_account') {
        const status = body.action === 'freeze_account' ? 'frozen' : 'active'
        const updated = await setUserStatus(target, status, buildAuditOperationInput(req, {
          actorUsername: authentication.username,
          action: `user.${body.action}`,
          targetType: 'user',
          targetId: target.id,
          reason: body.reason,
          before: userAuditSnapshot(target),
        }))
        return jsonResponse({ ok: true, user: toAdminAppUser(updated), detail: await buildAdminUserDetail(updated) })
      }

      if (body.action === 'delete_account') {
        const confirmedEmail = typeof body.confirm_email === 'string'
          ? body.confirm_email.trim().toLowerCase()
          : ''
        if (confirmedEmail !== target.email) {
          return jsonResponse({ error: '确认邮箱不匹配。' }, 400)
        }
        await deleteUserAccount(target.id, buildAuditOperationInput(req, {
          actorUsername: authentication.username,
          action: 'user.delete_account',
          targetType: 'user',
          targetId: target.id,
          reason: body.reason,
          before: userAuditSnapshot(target),
          after: { deleted: true },
        }))
        try {
          await recordAccountDeletedBehaviorEvent(target.id)
        } catch (error) {
          console.warn('account deletion behavior event could not be recorded:', error instanceof Error ? error.name : 'UnknownError')
        }
        return jsonResponse({ ok: true, deleted: true, user: { id: target.id, email: target.email } })
      }

      return jsonResponse({ error: '未知操作。' }, 400)
    }

    if (req.method === 'DELETE') {
      const body = await getValidatedJson(req, requestSchemas.adminUserDelete)
      const authentication = await authenticateAdminRequest(req, { capability: 'admin_manage', requireRecentLogin: true })
      if (!authentication.ok) return authentication.response
      const rootAuthentication = await requireRootAdminPassword(req, body.root_password)
      if (!rootAuthentication.ok) return rootAuthentication.response
      const deleted = await deleteAdminUser(
        body.username,
        buildAdminAuditContext(req, authentication.username, body.reason),
      )
      if (!deleted.ok) return jsonResponse({ error: deleted.message }, 400)
      return jsonResponse({ deleted: true })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof AdminPaginationError) return jsonResponse({ error: error.message }, 400)
    if (error instanceof AdminProfileMutationConflictError) return jsonResponse({ error: error.message }, 409)
    if (error instanceof PasswordWorkCapacityError) {
      return jsonResponse(
        { error: '认证服务繁忙，请稍后重试。' },
        429,
        {
          'Retry-After': '1',
          'Cache-Control': 'no-store',
          'Access-Control-Expose-Headers': 'Retry-After',
        },
      )
    }
    console.error('admin users error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function adminUserActionRequirement(action: string) {
  if (action === 'delete_account') {
    return { capability: 'user_delete' as const, requireRecentLogin: true }
  }
  const requireRecentLogin = action === 'reset_password'
    || action === 'set_profile_permission'
    || action === 'upgrade_preview_profile'
    || action === 'clear_profile_skland_binding'
    || action === 'clear_profile_workspace'
  return { capability: 'user_manage' as const, requireRecentLogin }
}

async function auditOperation(
  req: Request,
  input: Omit<Parameters<typeof recordAdminOperationAudit>[0], 'requestId' | 'clientIp'>,
): Promise<void> {
  await recordAdminOperationAudit(buildAuditOperationInput(req, input))
}

function buildAuditOperationInput(
  req: Request,
  input: Omit<Parameters<typeof recordAdminOperationAudit>[0], 'requestId' | 'clientIp'>,
): Parameters<typeof recordAdminOperationAudit>[0] {
  return {
    ...input,
    requestId: req.headers.get('x-request-id')?.trim() || randomUUID(),
    clientIp: getRequestClientIp(req),
  }
}

function userAuditSnapshot(user: UserAccountRecord) {
  return { id: user.id, email: user.email, status: user.status, permission: user.permission, updated_at: user.updated_at }
}

function buildAdminAuditContext(req: Request, actorUsername: string, reason: string) {
  const { requestId, clientIp } = buildAuditOperationInput(req, {
    actorUsername,
    action: 'admin_user.pending',
    targetType: 'admin_user',
    targetId: 'pending',
    reason,
  })
  return { actorUsername, reason, requestId, clientIp }
}

function profileAuditSnapshot(profile: UserGameAccountRecord) {
  return {
    id: profile.id,
    user_id: profile.user_id,
    status: profile.status,
    permission: profile.permission,
    kind: normalizeProfileKind(profile),
    display_name: profile.display_name,
    note: profile.note,
    has_skland_binding: Boolean(profile.skland_binding),
    has_skland_pending_binding: Boolean(profile.skland_pending_binding),
    has_skland_risk: Boolean(profile.skland_risk),
    updated_at: profile.updated_at,
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
  audit: Parameters<typeof saveUserAccountByAdmin>[1]['audit'],
): Promise<UserAccountRecord> {
  const updated: UserAccountRecord = {
    ...user,
    status,
    updated_at: new Date().toISOString(),
  }
  await saveUserAccountByAdmin(updated, {
    revokeSessions: status !== 'active',
    audit: { ...audit, after: userAuditSnapshot(updated) },
  })
  return updated
}

async function updateProfileSummary(
  profile: UserGameAccountRecord,
  displayNameValue: unknown,
  noteValue: unknown,
  context: AdminProfileMutationContext,
): Promise<UserGameAccountRecord> {
  const displayName = normalizeDisplayName(displayNameValue) || profile.display_name || '账号'
  const note = normalizeNote(noteValue)
  return saveProfilePatch(profile, { display_name: displayName, note }, context)
}

type AdminProfileMutationContext = Omit<Parameters<typeof saveUserProfileByAdmin>[1], 'expectedUpdatedAt' | 'audit'> & {
  audit: Omit<Parameters<typeof recordAdminOperationAudit>[0], 'requestId' | 'clientIp' | 'before' | 'after'>
  req: Request
}

function profileMutationContext(
  req: Request,
  actorUsername: string,
  action: string,
  reason: string,
  options: Omit<Parameters<typeof saveUserProfileByAdmin>[1], 'expectedUpdatedAt' | 'audit'> = {},
): AdminProfileMutationContext {
  return {
    ...options,
    req,
    audit: {
      actorUsername,
      action: `profile.${action}`,
      targetType: 'profile',
      targetId: '',
      reason,
    },
  }
}

async function saveProfilePatch(
  profile: UserGameAccountRecord,
  patch: Partial<UserGameAccountRecord>,
  context: AdminProfileMutationContext,
): Promise<UserGameAccountRecord> {
  const updated: UserGameAccountRecord = {
    ...profile,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  const { req, audit, ...storageOptions } = context
  await saveUserProfileByAdmin(updated, {
    ...storageOptions,
    expectedUpdatedAt: profile.updated_at,
    audit: buildAuditOperationInput(req, {
      ...audit,
      targetId: updated.id,
      before: profileAuditSnapshot(profile),
      after: profileAuditSnapshot(updated),
    }),
  })
  return updated
}

async function exportAdminUserWorkspaces(user: UserAccountRecord): Promise<Response> {
  const profiles = await listProfilesForUser(user.id)
  const workspaceMap = await listProfileWorkspaces(profiles.map((profile) => profile.id))
  const body = {
    version: 1,
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
    },
    profiles: profiles.map((profile) => {
      const workspace = workspaceMap.get(profile.id)
      return {
        id: profile.id,
        display_name: profile.display_name,
        kind: normalizeProfileKind(profile),
        permission: profile.permission,
        status: profile.status,
        workspace: workspace
          ? {
              version: 1,
              profile_id: workspace.profile_id,
              operators: workspace.operators,
              config: workspace.config,
              elite_overrides: workspace.elite_overrides,
              last_result: workspace.last_result,
              saved_configs: workspace.saved_configs,
              result_history: workspace.result_history,
              archived_results: workspace.archived_results,
              free_schedule_entitlement: workspace.free_schedule_entitlement,
              updated_at: workspace.updated_at,
            }
          : null,
      }
    }),
  } satisfies AdminUserWorkspaceExportV1

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="maa-user-workspaces.json"',
      'Cache-Control': 'no-store',
    },
  })
}

async function buildAdminUserDetail(
  user: UserAccountRecord,
  profilePage: AdminProfilePageRequest = { page: 1, pageSize: 100 },
) {
  const [allProfiles, personalUseDeclarations, personalUseUsageEvents] = await Promise.all([
    listProfilesForUser(user.id),
    listPersonalUseDeclarationAcceptancesForUser(user.id),
    listPersonalUseDeclarationUsageEventsForUser(user.id),
  ])
  const pagination = buildAdminPagination(profilePage.page, profilePage.pageSize, allProfiles.length)
  const profileOffset = (pagination.page - 1) * pagination.page_size
  const profiles = allProfiles.slice(profileOffset, profileOffset + pagination.page_size)
  const [workspaceMap, cdkMap] = await Promise.all([
    listProfileWorkspaces(profiles.map((profile) => profile.id)),
    listCdkRecordsByKeys(profiles.flatMap((profile) => profile.cdk_key ? [profile.cdk_key] : [])),
  ])
  const personalUseAudit = [
    ...personalUseDeclarations.map((acceptance) => ({
      profile_id: acceptance.profile_id,
      declaration_id: acceptance.declaration_id,
      declaration_version: acceptance.declaration_version,
      action: acceptance.action,
      client_ip: acceptance.client_ip,
      accepted_at: acceptance.accepted_at,
      account_deleted_at: acceptance.account_deleted_at,
      retain_until: acceptance.retain_until,
    })),
    ...personalUseUsageEvents.map((event) => ({
      profile_id: event.profile_id,
      declaration_id: event.declaration_id,
      declaration_version: event.declaration_version,
      action: event.action,
      client_ip: event.client_ip,
      accepted_at: event.occurred_at,
      account_deleted_at: event.account_deleted_at,
      retain_until: event.retain_until,
    })),
  ].sort((left, right) => right.accepted_at.localeCompare(left.accepted_at))
  return {
    user: { ...toAdminAppUser(user, allProfiles), profile_count: allProfiles.length },
    profiles: await Promise.all(profiles.map((profile) => buildAdminProfileSummary(profile, {
      workspace: workspaceMap.get(profile.id) ?? null,
      cdk: profile.cdk_key ? cdkMap.get(profile.cdk_key) ?? null : null,
    }))),
    profile_pagination: {
      ...pagination,
      returned: profiles.length,
      truncated: allProfiles.length > profiles.length,
    },
    personal_use_declarations: personalUseAudit,
  }
}

async function buildAdminProfileSummary(
  profile: UserGameAccountRecord,
  prefetched?: { workspace: UserWorkspaceRecord | null; cdk: CdkRecord | null },
) {
  const workspace = prefetched ? prefetched.workspace : await getProfileWorkspace(profile.id)
  const cdk = prefetched
    ? prefetched.cdk
    : profile.cdk_key ? await (await getCdkRecordStore()).get(profile.cdk_key) : null
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
    skland_pending_binding: summarizeSklandPendingBinding(profile),
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

function summarizeSklandPendingBinding(profile: UserGameAccountRecord) {
  const pending = profile.skland_pending_binding
  if (!pending) return null
  if (pending.stage === 'account_selection') {
    return {
      stage: pending.stage,
      account_count: pending.accounts.length,
      created_at: pending.created_at,
      expires_at: pending.expires_at,
    }
  }
  return {
    stage: pending.stage ?? 'confirmation',
    uid: pending.uid,
    nickname: pending.nickname,
    channel_name: pending.channel_name,
    operator_count: pending.operator_count,
    created_at: pending.created_at,
    expires_at: pending.expires_at,
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
      kind: profile.kind,
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
  }
}

function toAdminAppUser(user: UserAccountRecord, profiles: UserGameAccountRecord[] = []) {
  return {
    id: user.id,
    email: user.email,
    email_verified_at: user.email_verified_at,
    permission: user.permission,
    status: user.status,
    cdk_order_hash: user.cdk_order_hash,
    profile_access: profiles.map((profile) => ({
      kind: normalizeProfileKind(profile),
      permission: profile.permission,
    })),
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
