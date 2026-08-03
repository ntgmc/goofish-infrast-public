import { randomUUID } from 'node:crypto'
import type { LicenseOperator, PermissionMode } from '../../src/lib/types'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  isFreePreviewProfile,
  normalizeProfileKind,
  toPublicWorkspace,
  updateProfileWorkspaceAtomically,
  updateProfileWorkspaceInTransaction,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import {
  evaluateOperatorRisk,
  formatOperatorRiskBlockMessage,
  getRiskControlSettings,
  isProfileCdkRecord,
  recordOperatorFingerprint,
  recordSoftBlockedRiskEvent,
  resolveConfigForPermission,
  resolveFreePreviewConfig,
  validateConfig,
  validateOperators,
} from './license-utils'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'
import { isFreePreviewTrialActive } from '../free-preview-trial'
import { resolveProfileAuthorization } from './profile-authorization'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getProfileCapacityLimits } from '../storage/inventory-store'
import { hasDatabaseUrl, withTransaction } from '../storage/postgres'
import { recordAuthenticatedRequestBehaviorEvent, recordOperatorDataAnomalyBehaviorEvent } from '../behavior-risk/service'
import { confirmFreeScheduleEntitlement, FreeScheduleConfirmationError } from '../storage/reorder-admission'
import { recordOperatorFingerprintInTransaction } from '../storage/cdk-store'

export default async (req: Request): Promise<Response> => {

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
      const authorization = await resolveProfileAuthorization(profile)
      if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
      const capacityLimits = await getWorkspaceCapacityLimits(profile.id)
      const workspace = await getProfileWorkspace(profile.id)
      return jsonResponse({
        ...(await buildAuthPayload(auth.user, profile.id)),
        workspace: toPublicWorkspace(workspace, capacityLimits, {
          kind: normalizeProfileKind(profile),
          permission: authorization.permission,
        }),
      })
    }

    if (req.method !== 'PATCH' && req.method !== 'POST') {
      return jsonResponse({ error: '方法不允许。' }, 405)
    }

    const isFreeScheduleConfirmRequest = url.pathname.endsWith('/free-schedule/confirm')
    const body = isFreeScheduleConfirmRequest
      ? await getValidatedJson(req, requestSchemas.workspaceFreeScheduleConfirm)
      : await getValidatedJson(req, requestSchemas.userWorkspace)
    if (typeof body.profile_id !== 'string' || !body.profile_id) {
      return jsonResponse({ error: '缺少 profile_id。' }, 400)
    }
    const profile = await getProfileForUser(auth.user.id, body.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案不能保存排班工作区。' }, 403)
    if (profile.archived_at) return jsonResponse({ error: '归档档案不能写入工作区。', code: 'profile_archived' }, 409)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)

    const isPreviewProfile = isFreePreviewProfile(profile)
    const isPreviewTrial = isFreePreviewTrialActive(profile)
    const effectivePermission = authorization.permission
    const isRestrictedPreview = isPreviewProfile && !isPreviewTrial
    const capacityLimits = await getWorkspaceCapacityLimits(profile.id)
    if (isPreviewProfile && !profile.skland_binding) {
      return jsonResponse({ error: '免费个人排班档案必须先绑定森空岛后才能保存工作区数据。' }, 403)
    }

    if (isFreeScheduleConfirmRequest) {
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      if (!isRestrictedPreview) return jsonResponse({ error: '当前档案不需要确认免费方案。' }, 403)
      if (!('result_history_id' in body)) return jsonResponse({ error: '缺少 result_history_id。' }, 400)
      const next = await confirmFreeScheduleEntitlement(profile.id, body.result_history_id)
      await recordAuthenticatedRequestBehaviorEvent({ req, auth, eventType: 'workspace_save', profileId: profile.id })
      return jsonResponse({
        ...(await buildAuthPayload(auth.user, profile.id)),
        workspace: toPublicWorkspace(next, capacityLimits, {
          kind: normalizeProfileKind(profile),
          permission: authorization.permission,
        }),
      })
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

    let acceptedOperatorFingerprint: Parameters<typeof recordOperatorFingerprint> | null = null
    if (operatorsValue) {
      const cdkRecord = authorization.cdkRecord
      if (cdkRecord && isProfileCdkRecord(cdkRecord) && authorization.permission === 'advanced') {
        const riskSettings = await getRiskControlSettings()
        if (riskSettings.operator_data_risk_enabled) {
          const operatorRisk = evaluateOperatorRisk(cdkRecord, operatorsValue)
          if (!operatorRisk.ok) {
            const blocked = await recordSoftBlockedRiskEvent(
              cdkRecord,
              operatorRisk.event,
              formatOperatorRiskBlockMessage(operatorRisk.event.reason),
              operatorRisk.fingerprint,
            )
            await recordOperatorDataAnomalyBehaviorEvent({
              req,
              auth,
              profileId: profile.id,
              uid: profile.skland_binding?.uid ?? null,
              anomalyType: operatorRisk.event.type,
              fingerprintHash: operatorRisk.fingerprint.hash,
              ownedCount: operatorRisk.fingerprint.owned_count,
              occurredAt: new Date(operatorRisk.event.at),
            })
            return jsonResponse({ error: blocked.message }, blocked.frozen ? 403 : 409)
          }
          acceptedOperatorFingerprint = [cdkRecord, operatorRisk.fingerprint]
        }
      }
    }

    const mutateWorkspace = (currentWorkspace: UserWorkspaceRecord | null) => {
      const workspace: UserWorkspaceRecord = { ...(currentWorkspace ?? emptyWorkspace(profile.id)) }
      if ('operators' in body) workspace.operators = operatorsValue ?? null
      if ('config' in body) workspace.config = configValue ?? null
      if ('elite_overrides' in body) {
        const operators = 'operators' in body ? operatorsValue ?? null : workspace.operators
        workspace.elite_overrides = validateEliteOverridesForOperators(body.elite_overrides, operators)
      }
      if ('saved_config_action' in body) {
        const savedConfigResult = applySavedConfigAction(workspace, body.saved_config_action, effectivePermission, isRestrictedPreview, capacityLimits.plan)
        if (!savedConfigResult.ok) throw new WorkspaceMutationError(savedConfigResult.message, savedConfigResult.status ?? 400)
      }
      if ('operators' in body) workspace.last_result = null
      workspace.updated_at = new Date().toISOString()
      return workspace
    }
    if (acceptedOperatorFingerprint && hasDatabaseUrl()) {
      await withTransaction(async (client) => {
        await updateProfileWorkspaceInTransaction(client, profile.id, mutateWorkspace)
        await recordOperatorFingerprintInTransaction(client, ...acceptedOperatorFingerprint!)
      })
    } else {
      await updateProfileWorkspaceAtomically(profile.id, mutateWorkspace)
      if (acceptedOperatorFingerprint) await recordOperatorFingerprint(...acceptedOperatorFingerprint)
    }
    await recordAuthenticatedRequestBehaviorEvent({ req, auth, eventType: 'workspace_save', profileId: profile.id })
    return jsonResponse(await buildAuthPayload(auth.user, profile.id))
  } catch (error) {
    if (error instanceof WorkspaceMutationError || error instanceof FreeScheduleConfirmationError) {
      return jsonResponse({ error: error.message }, error.status)
    }
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

function validateEliteOverridesForOperators(
  value: Record<string, number>,
  operators: LicenseOperator[] | null,
): Record<string, number> {
  const operatorIds = new Set((operators ?? []).map((operator) => operator.id))
  for (const operatorId of Object.keys(value)) {
    if (!operatorIds.has(operatorId)) {
      throw new WorkspaceMutationError(`精英覆盖中的干员 ${operatorId} 不属于当前工作区。`, 400)
    }
  }
  return { ...value }
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
    if (!workspace.saved_configs.some((item) => item.id === idResult.id)) {
      return { ok: false, message: '方案不存在。', status: 404 }
    }
    workspace.saved_configs = workspace.saved_configs.filter((item) => item.id !== idResult.id)
    return { ok: true }
  }

  if (rawAction.type === 'touch') {
    const idResult = normalizeActionId(rawAction.id)
    if (!idResult.ok) return idResult
    if (!workspace.saved_configs.some((item) => item.id === idResult.id)) {
      return { ok: false, message: '方案不存在。', status: 404 }
    }
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
