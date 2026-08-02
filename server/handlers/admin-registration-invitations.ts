import type { AdminRegistrationInvitationStatus } from '../../src/lib/types'
import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { buildAdminPagination } from './admin-pagination'
import { jsonResponse, resendEmailVerificationForUserId } from './user-auth'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import {
  createAdminRegistrationInvitation,
  listAdminRegistrationInvitations,
  AdminRegistrationInvitationOperationError,
  recordAdminInvitationVerificationResend,
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
      let body
      try {
        body = await getValidatedJson(req, requestSchemas.adminRegistrationInvitationCreate)
      } catch (error) {
        return jsonResponse({ error: requestErrorMessage(error) }, 400)
      }
      const root = await requireRootAdminPassword(req, body.root_password)
      if (!root.ok) return root.response
      const created = await createAdminRegistrationInvitation({
        adminUsername: authentication.username,
        reason: body.reason,
        idempotencyKey: body.idempotency_key,
        encryptionSecret: body.root_password,
      })
      return jsonResponse({
        invitation: created.invitation,
        code: created.code,
        share_url: `/tool/profiles?invite=${encodeURIComponent(created.code)}`,
      }, 201)
    }
    if (req.method === 'PATCH') {
      let body
      try {
        body = await getValidatedJson(req, requestSchemas.adminRegistrationInvitationPatch)
      } catch (error) {
        return jsonResponse({ error: requestErrorMessage(error) }, 400)
      }
      if (body.action !== 'revoke' && body.action !== 'resend_verification') {
        return jsonResponse({ error: '管理员邀请码操作无效。' }, 400)
      }
      const root = await requireRootAdminPassword(req, body.root_password)
      if (!root.ok) return root.response
      if (body.action === 'resend_verification') {
        const userId = await recordAdminInvitationVerificationResend(
          body.invitation_id,
          authentication.username,
          body.reason,
        )
        if (!userId) return jsonResponse({ error: '邀请码未使用、账户已验证或记录不存在。' }, 409)
        if (!(await resendEmailVerificationForUserId(userId))) {
          return jsonResponse({ error: '账户已验证或不存在。' }, 409)
        }
        return jsonResponse({ ok: true })
      }
      const invitation = await revokeAdminRegistrationInvitation({
        invitationId: body.invitation_id,
        adminUsername: authentication.username,
        reason: body.reason,
      })
      if (!invitation) return jsonResponse({ error: '邀请码不存在、已使用或已过期。' }, 409)
      return jsonResponse({ invitation })
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof AdminRegistrationInvitationOperationError) {
      return jsonResponse({ error: error.message, code: error.code }, 409)
    }
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
