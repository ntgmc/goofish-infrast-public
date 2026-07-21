import type { AdminRegistrationInvitationStatus } from '../../src/lib/types'
import { authenticateAdminRequest } from './admin-auth'
import { buildAdminPagination } from './admin-pagination'
import { jsonResponse } from './user-auth'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import {
  createAdminRegistrationInvitation,
  listAdminRegistrationInvitations,
  revokeAdminRegistrationInvitation,
} from '../storage/admin-registration-invitation-store'

const STATUSES = new Set<AdminRegistrationInvitationStatus | 'all'>(['all', 'active', 'used', 'revoked', 'expired'])

export default async function adminRegistrationInvitationsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response

    if (req.method === 'GET') return handleList(req)
    if (req.method === 'POST') {
      try {
        await getValidatedJson(req, requestSchemas.adminRegistrationInvitationCreate)
      } catch (error) {
        return jsonResponse({ error: requestErrorMessage(error) }, 400)
      }
      const created = await createAdminRegistrationInvitation()
      return jsonResponse({
        invitation: created.invitation,
        code: created.code,
        share_url: `/tool/profiles?invite=${encodeURIComponent(created.code)}`,
      }, 201)
    }
    if (req.method === 'PATCH') {
      let body: { invitation_id: string; action: 'revoke' }
      try {
        body = await getValidatedJson(req, requestSchemas.adminRegistrationInvitationPatch)
      } catch (error) {
        return jsonResponse({ error: requestErrorMessage(error) }, 400)
      }
      if (body.action !== 'revoke' || typeof body.invitation_id !== 'string' || !body.invitation_id.trim()) {
        return jsonResponse({ error: '管理员邀请码撤销请求无效。' }, 400)
      }
      const invitation = await revokeAdminRegistrationInvitation(body.invitation_id)
      if (!invitation) return jsonResponse({ error: '邀请码不存在、已使用或已过期。' }, 409)
      return jsonResponse({ invitation })
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof AdminInvitationRequestError) return jsonResponse({ error: error.message }, 400)
    console.error('admin registration invitations error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const page = parseInteger(url.searchParams.get('page') ?? '1', 'page', 1, Number.MAX_SAFE_INTEGER)
  const pageSize = parseInteger(url.searchParams.get('page_size') ?? '20', 'page_size', 1, 100)
  const statusValue = url.searchParams.get('status') ?? 'all'
  if (!STATUSES.has(statusValue as AdminRegistrationInvitationStatus | 'all')) {
    throw new AdminInvitationRequestError('status 必须是 all、active、used、revoked 或 expired。')
  }
  const status = statusValue as AdminRegistrationInvitationStatus | 'all'
  const result = await listAdminRegistrationInvitations({ page, pageSize, status })
  return jsonResponse({
    invitations: result.records,
    status,
    pagination: buildAdminPagination(result.page, pageSize, result.total),
  })
}

function parseInteger(value: string, field: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new AdminInvitationRequestError(`${field} 必须是整数。`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new AdminInvitationRequestError(`${field} 必须在 ${min} 到 ${max} 之间。`)
  }
  return parsed
}

class AdminInvitationRequestError extends Error {}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '管理员邀请码请求无效。'
}
