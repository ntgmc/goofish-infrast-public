import { randomUUID } from 'node:crypto'
import type { FreeScheduleEntitlement, OptimizeResult, PermissionMode } from '../../src/lib/types'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  isFreePreviewProfile,
  toPublicWorkspace,
  updateProfileWorkspaceAtomically,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { resolveConfigForPermission, resolveFreePreviewConfig, validateConfig, validateOperators } from './license-utils'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'
import { getEffectiveProfilePermission, isFreePreviewTrialActive } from '../free-preview-trial'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getProfileCapacityLimits } from '../storage/inventory-store'
import { hasDatabaseUrl } from '../storage/postgres'

const FREE_SCHEDULE_REVISION_LIMIT = 3
const FREE_SCHEDULE_REVISION_WINDOW_HOURS = 24

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const url = new URL(req.url)

    if (req.method === 'GET') {
      const profileId = url.searchParams.get('profile_id')
      if (!profileId) return jsonResponse({ error: '缺少 profile_id。' }, 400)
      const profile = await getProfileForUser(auth.user.id, profileId)
      if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
      if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案没有排班工作区。' }, 403)
      const capacityLimits = await getWorkspaceCapacityLimits(profile.id)
      const workspace = await getProfileWorkspace(profile.id)
      return jsonResponse({ ...(await buildAuthPayload(auth.user, profile.id)), workspace: toPublicWorkspace(workspace, capacityLimits) })
    }

    if (req.method !== 'PATCH' && req.method !== 'POST') {
      return jsonResponse({ error: '方法不允许。' }, 405)
    }

    const body = await getValidatedJson(req, requestSchemas.userWorkspace)
    if (typeof body.profile_id !== 'string' || !body.profile_id) {
      return jsonResponse({ error: '缺少 profile_id。' }, 400)
    }
    const profile = await getProfileForUser(auth.user.id, body.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案不能保存排班工作区。' }, 403)
    if (profile.status !== 'active') return jsonResponse({ error: '账号档案状态不可用。' }, 403)

    const isPreviewProfile = isFreePreviewProfile(profile)
    const isPreviewTrial = isFreePreviewTrialActive(profile)
    const effectivePermission = getEffectiveProfilePermission(profile)
    const isRestrictedPreview = isPreviewProfile && !isPreviewTrial
    const capacityLimits = await getWorkspaceCapacityLimits(profile.id)
    if (isPreviewProfile && !profile.skland_binding) {
      return jsonResponse({ error: '免费个人排班档案必须先绑定森空岛后才能保存工作区数据。' }, 403)
    }

    if (url.pathname.endsWith('/free-schedule/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      if (!isRestrictedPreview) return jsonResponse({ error: '当前档案不需要确认免费方案。' }, 403)
      const now = new Date().toISOString()
      const next = await updateProfileWorkspaceAtomically(profile.id, (currentWorkspace) => {
        const workspace = currentWorkspace ?? emptyWorkspace(profile.id)
        const historyItem = typeof body.result_history_id === 'string' && body.result_history_id.trim()
          ? workspace.result_history.find((item) => item.id === body.result_history_id)
          : workspace.result_history[0]
        if (!historyItem) throw new WorkspaceMutationError('暂无可确认的免费排班方案。', 409)
        const current = normalizeFreeScheduleEntitlementForConfirm(workspace.free_schedule_entitlement)
        return {
          ...workspace,
          free_schedule_entitlement: {
            ...current,
            first_generated_at: current.first_generated_at ?? historyItem.created_at,
            revision_count: Math.max(1, current.revision_count),
            confirmed_at: now,
            locked_at: now,
            lock_reason: 'confirmed',
          },
          updated_at: now,
        }
      })
      return jsonResponse({ ...(await buildAuthPayload(auth.user, profile.id)), workspace: toPublicWorkspace(next, capacityLimits) })
    }

    let operatorsValue: UserWorkspaceRecord['operators'] | undefined

    if ('operators' in body) {
      if (isPreviewProfile) {
        return jsonResponse({ error: '免费个人排班档案的干员数据只能通过森空岛导入更新。' }, 403)
      }
      if (body.operators === null) {
        operatorsValue = null
      } else {
        const operatorsCheck = validateOperators(body.operators)
        if (!operatorsCheck.ok) return jsonResponse({ error: operatorsCheck.message }, 400)
        operatorsValue = operatorsCheck.operators
      }
    }

    let configValue: UserWorkspaceRecord['config'] | undefined
    if ('config' in body) {
      if (body.config === null) {
        configValue = null
      } else {
        const configCheck = validateConfig(body.config)
        if (!configCheck.ok) return jsonResponse({ error: configCheck.message }, 400)
        const permissionCheck = isRestrictedPreview
          ? resolveFreePreviewConfig(configCheck.config)
          : resolveConfigForPermission(effectivePermission, configCheck.config)
        if (!permissionCheck.ok) return jsonResponse({ error: permissionCheck.message }, 403)
        configValue = permissionCheck.config
      }
    }

    await updateProfileWorkspaceAtomically(profile.id, (currentWorkspace) => {
      const workspace: UserWorkspaceRecord = { ...(currentWorkspace ?? emptyWorkspace(profile.id)) }
      if ('operators' in body) workspace.operators = operatorsValue ?? null
      if ('config' in body) workspace.config = configValue ?? null
      if ('elite_overrides' in body) workspace.elite_overrides = normalizeEliteOverrides(body.elite_overrides)
      if ('last_result' in body) {
        workspace.last_result = body.last_result && typeof body.last_result === 'object' ? body.last_result as OptimizeResult : null
      }
      if ('saved_config_action' in body) {
        const savedConfigResult = applySavedConfigAction(workspace, body.saved_config_action, effectivePermission, isRestrictedPreview, capacityLimits.plan)
        if (!savedConfigResult.ok) throw new WorkspaceMutationError(savedConfigResult.message, savedConfigResult.status ?? 400)
      }
      if ('operators' in body) workspace.last_result = null
      workspace.updated_at = new Date().toISOString()
      return workspace
    })
    return jsonResponse(await buildAuthPayload(auth.user, profile.id))
  } catch (error) {
    if (error instanceof WorkspaceMutationError) return jsonResponse({ error: error.message }, error.status)
    console.error('user workspace error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function getWorkspaceCapacityLimits(profileId: string): Promise<{ plan: number; history: number; archive: number }> {
  if (hasDatabaseUrl()) return getProfileCapacityLimits(profileId)
  return Promise.resolve({ plan: WORKSPACE_SAVED_CONFIG_LIMIT, history: WORKSPACE_RESULT_HISTORY_LIMIT, archive: 0 })
}

class WorkspaceMutationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WorkspaceMutationError'
  }
}

function normalizeEliteOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) normalized[key] = raw
  }
  return normalized
}

type SavedConfigActionResult =
  | { ok: true }
  | { ok: false; message: string; status?: number }

function applySavedConfigAction(
  workspace: UserWorkspaceRecord,
  rawAction: unknown,
  permission: PermissionMode,
  isRestrictedPreview = false,
  savedConfigLimit = 3,
): SavedConfigActionResult {
  if (!isRecord(rawAction) || typeof rawAction.type !== 'string') {
    return { ok: false, message: '保存方案操作不正确。' }
  }

  const actionId = typeof rawAction.id === 'string' ? rawAction.id : null
  const readOnlyTarget = actionId ? workspace.saved_configs.find((item) => item.id === actionId) : null
  if (readOnlyTarget?.read_only) {
    return { ok: false, message: '体验期保存的高级配置已只读，不能修改、删除或再次套用。', status: 403 }
  }

  if (rawAction.type === 'save') {
    const nameResult = normalizeSavedConfigName(rawAction.name)
    if (!nameResult.ok) return nameResult

    const configCheck = validateConfig(rawAction.config)
    if (!configCheck.ok) return { ok: false, message: configCheck.message }
    const permissionCheck = isRestrictedPreview
      ? resolveFreePreviewConfig(configCheck.config)
      : resolveConfigForPermission(permission, configCheck.config)
    if (!permissionCheck.ok) return { ok: false, message: permissionCheck.message, status: 403 }

    const now = new Date().toISOString()
    const id = typeof rawAction.id === 'string' && rawAction.id ? rawAction.id : randomUUID()
    const existing = workspace.saved_configs.find((item) => item.id === id)
    if (existing?.read_only) return { ok: false, message: '体验期保存的高级配置已只读，不能覆盖。', status: 403 }
    const duplicate = workspace.saved_configs.find((item) => item.id !== id && item.name === nameResult.name)
    if (duplicate) return { ok: false, message: '已存在同名方案。' }
    if (!existing && workspace.saved_configs.length >= savedConfigLimit) {
      return { ok: false, message: `最多保存 ${savedConfigLimit} 套配置，请先删除不再需要的方案。` }
    }

    const saved = {
      id,
      name: nameResult.name,
      config: permissionCheck.config,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_used_at: existing?.last_used_at ?? null,
    }
    workspace.saved_configs = existing
      ? workspace.saved_configs.map((item) => item.id === id ? saved : item)
      : [saved, ...workspace.saved_configs]
    return { ok: true }
  }

  if (rawAction.type === 'rename') {
    const idResult = normalizeActionId(rawAction.id)
    if (!idResult.ok) return idResult
    const nameResult = normalizeSavedConfigName(rawAction.name)
    if (!nameResult.ok) return nameResult
    const target = workspace.saved_configs.find((item) => item.id === idResult.id)
    if (!target) return { ok: false, message: '方案不存在。', status: 404 }
    const duplicate = workspace.saved_configs.find((item) => item.id !== idResult.id && item.name === nameResult.name)
    if (duplicate) return { ok: false, message: '已存在同名方案。' }
    const now = new Date().toISOString()
    workspace.saved_configs = workspace.saved_configs.map((item) => item.id === idResult.id
      ? { ...item, name: nameResult.name, updated_at: now }
      : item)
    return { ok: true }
  }

  if (rawAction.type === 'delete') {
    const idResult = normalizeActionId(rawAction.id)
    if (!idResult.ok) return idResult
    workspace.saved_configs = workspace.saved_configs.filter((item) => item.id !== idResult.id)
    return { ok: true }
  }

  if (rawAction.type === 'touch') {
    const idResult = normalizeActionId(rawAction.id)
    if (!idResult.ok) return idResult
    const now = new Date().toISOString()
    workspace.saved_configs = workspace.saved_configs.map((item) => item.id === idResult.id
      ? { ...item, last_used_at: now }
      : item)
    return { ok: true }
  }

  return { ok: false, message: '未知的保存方案操作。' }
}

function normalizeSavedConfigName(value: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: '方案名称不正确。' }
  const name = value.trim()
  if (name.length < 1 || name.length > 40) return { ok: false, message: '方案名称需为 1-40 个字符。' }
  return { ok: true, name }
}

function normalizeActionId(value: unknown): { ok: true; id: string } | { ok: false; message: string } {
  if (typeof value !== 'string' || !value) return { ok: false, message: '方案不存在。' }
  return { ok: true, id: value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeFreeScheduleEntitlementForConfirm(value: FreeScheduleEntitlement | null | undefined): FreeScheduleEntitlement {
  return {
    first_generated_at: typeof value?.first_generated_at === 'string' ? value.first_generated_at : null,
    revision_count: Math.max(0, Math.floor(Number(value?.revision_count ?? 0))),
    revision_limit: FREE_SCHEDULE_REVISION_LIMIT,
    revision_window_hours: FREE_SCHEDULE_REVISION_WINDOW_HOURS,
    confirmed_at: typeof value?.confirmed_at === 'string' ? value.confirmed_at : null,
    locked_at: typeof value?.locked_at === 'string' ? value.locked_at : null,
    lock_reason: value?.lock_reason ?? null,
    strong_reorder_bonus: value?.strong_reorder_bonus ?? null,
  }
}
