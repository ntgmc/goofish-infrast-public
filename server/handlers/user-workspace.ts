import type { OptimizeResult } from '../../src/lib/types'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  saveProfileWorkspace,
  toPublicWorkspace,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { resolveConfigForPermission, validateConfig, validateOperators } from './license-utils'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'

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

    if ('operators' in body) {
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
        const permissionCheck = resolveConfigForPermission(profile.permission, configCheck.config)
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
