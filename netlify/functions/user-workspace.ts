import type { Context } from '@netlify/functions'
import type { LicenseConfig, LicenseOperator, OptimizeResult } from '../../src/lib/types'
import {
  emptyWorkspace,
  getWorkspace,
  saveWorkspace,
  toPublicWorkspace,
  type UserWorkspaceRecord,
} from '../../server/storage/user-store'
import { resolveConfigForPermission, validateConfig, validateOperators } from './license-utils'
import { jsonResponse, requireUserSession, toPublicUser } from './user-auth'

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    if (req.method === 'GET') {
      const workspace = await getWorkspace(auth.user.id)
      return jsonResponse({ user: toPublicUser(auth.user), workspace: toPublicWorkspace(workspace) })
    }

    if (req.method !== 'PATCH' && req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const body = await req.json() as {
      operators?: unknown
      config?: unknown
      elite_overrides?: unknown
      last_result?: unknown
    }
    const existing = await getWorkspace(auth.user.id)
    const next: UserWorkspaceRecord = existing ?? emptyWorkspace(auth.user.id)

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
        const permissionCheck = resolveConfigForPermission(auth.user.permission, configCheck.config)
        if (!permissionCheck.ok) return jsonResponse({ error: permissionCheck.message }, 403)
        next.config = permissionCheck.config
      }
    }

    if ('elite_overrides' in body) {
      next.elite_overrides = normalizeEliteOverrides(body.elite_overrides)
    }

    if ('last_result' in body) {
      next.last_result = body.last_result && typeof body.last_result === 'object'
        ? body.last_result as OptimizeResult
        : null
    }

    next.updated_at = new Date().toISOString()
    await saveWorkspace(next)
    return jsonResponse({ user: toPublicUser(auth.user), workspace: toPublicWorkspace(next) })
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
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      normalized[key] = raw
    }
  }
  return normalized
}
