import { randomUUID } from 'node:crypto'
import type { OptimizeResult, PermissionMode } from '../../src/lib/types'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  isFreePreviewProfile,
  saveProfileWorkspace,
  toPublicWorkspace,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { resolveConfigForPermission, validateConfig, validateOperators } from './license-utils'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'

const WORKSPACE_SAVED_CONFIG_LIMIT = 20

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    if (req.method === 'GET') {
      const profileId = new URL(req.url).searchParams.get('profile_id')
      if (!profileId) return jsonResponse({ error: '缺少 profile_id。' }, 400)
      const profile = await getProfileForUser(auth.user.id, profileId)
      if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
      if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案没有排班工作区。' }, 403)
      const workspace = await getProfileWorkspace(profile.id)
      return jsonResponse({ ...(await buildAuthPayload(auth.user, profile.id)), workspace: toPublicWorkspace(workspace) })
    }

    if (req.method !== 'PATCH' && req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const body = await req.json() as {
      profile_id?: unknown
      operators?: unknown
      config?: unknown
      elite_overrides?: unknown
      last_result?: unknown
      saved_config_action?: unknown
    }
    if (typeof body.profile_id !== 'string' || !body.profile_id) {
      return jsonResponse({ error: '缺少 profile_id。' }, 400)
    }
    const profile = await getProfileForUser(auth.user.id, body.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案不能保存排班工作区。' }, 403)
    if (profile.status !== 'active') return jsonResponse({ error: '账号档案状态不可用。' }, 403)

    const existing = await getProfileWorkspace(profile.id)
    const next: UserWorkspaceRecord = existing ?? emptyWorkspace(profile.id)
    let operatorsPatched = false

    if ('operators' in body) {
      operatorsPatched = true
      if (body.operators === null) {
        next.operators = null
      } else {
        const operatorsCheck = validateOperators(body.operators)
        if (!operatorsCheck.ok) return jsonResponse({ error: operatorsCheck.message }, 400)
        next.operators = operatorsCheck.operators
      }
    }

    if ('config' in body) {
      if (body.config === null) {
        next.config = null
      } else {
        const configCheck = validateConfig(body.config)
        if (!configCheck.ok) return jsonResponse({ error: configCheck.message }, 400)
        const permissionCheck = isFreePreviewProfile(profile)
          ? { ok: true as const, config: configCheck.config }
          : resolveConfigForPermission(profile.permission, configCheck.config)
        if (!permissionCheck.ok) return jsonResponse({ error: permissionCheck.message }, 403)
        next.config = permissionCheck.config
      }
    }

    if ('elite_overrides' in body) {
      next.elite_overrides = normalizeEliteOverrides(body.elite_overrides)
    }

    if ('last_result' in body) {
      next.last_result = body.last_result && typeof body.last_result === 'object' ? body.last_result as OptimizeResult : null
    }

    if ('saved_config_action' in body) {
      const savedConfigResult = applySavedConfigAction(next, body.saved_config_action, profile.permission, isFreePreviewProfile(profile))
      if (!savedConfigResult.ok) return jsonResponse({ error: savedConfigResult.message }, savedConfigResult.status ?? 400)
    }

    if (operatorsPatched) {
      next.last_result = null
    }

    next.updated_at = new Date().toISOString()
    await saveProfileWorkspace(next)
    return jsonResponse(await buildAuthPayload(auth.user, profile.id))
  } catch (error) {
    console.error('user workspace error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
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
  allowAnyConfig = false,
): SavedConfigActionResult {
  if (!isRecord(rawAction) || typeof rawAction.type !== 'string') {
    return { ok: false, message: '保存方案操作不正确。' }
  }

  if (rawAction.type === 'save') {
    const nameResult = normalizeSavedConfigName(rawAction.name)
    if (!nameResult.ok) return nameResult

    const configCheck = validateConfig(rawAction.config)
    if (!configCheck.ok) return { ok: false, message: configCheck.message }
    const permissionCheck = allowAnyConfig
      ? { ok: true as const, config: configCheck.config }
      : resolveConfigForPermission(permission, configCheck.config)
    if (!permissionCheck.ok) return { ok: false, message: permissionCheck.message, status: 403 }

    const now = new Date().toISOString()
    const id = typeof rawAction.id === 'string' && rawAction.id ? rawAction.id : randomUUID()
    const existing = workspace.saved_configs.find((item) => item.id === id)
    const duplicate = workspace.saved_configs.find((item) => item.id !== id && item.name === nameResult.name)
    if (duplicate) return { ok: false, message: '已存在同名方案。' }
    if (!existing && workspace.saved_configs.length >= WORKSPACE_SAVED_CONFIG_LIMIT) {
      return { ok: false, message: `最多保存 ${WORKSPACE_SAVED_CONFIG_LIMIT} 套配置，请先删除不再需要的方案。` }
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
