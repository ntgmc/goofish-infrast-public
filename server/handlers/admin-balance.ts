import { randomUUID } from 'node:crypto'
import { normalizePointsAmount } from '../../src/lib/balance-contracts'
import { adjustBalance, BalanceError, createBalanceRequestHash, getAdminBalancePage, reverseQualificationCredit } from '../storage/balance-store'
import { getUserById } from '../storage/user-store'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'

export default async function adminBalanceHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const userId = url.searchParams.get('user_id')?.trim() ?? ''
      if (!userId || !(await getUserById(userId))) return jsonResponse({ error: '用户不存在。', code: 'user_not_found' }, 404)
      const rawLimit = url.searchParams.get('limit')
      const limit = rawLimit === null ? undefined : Number(rawLimit)
      return jsonResponse(await getAdminBalancePage(userId, { cursor: url.searchParams.get('cursor'), limit }))
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
    const body = await getValidatedJson(req, requestSchemas.adminBalanceAdjust)
    const amount = normalizePointsAmount(body.amount)
    if (!amount) return jsonResponse({ error: '积分金额必须是 0.01 到 1000000.00 之间、最多两位小数的字符串。', code: 'invalid_amount' }, 400)
    const reason = body.reason.trim()
    if (!reason) return jsonResponse({ error: '积分调整原因不能为空。', code: 'invalid_reason' }, 400)
    if (body.operation === 'reverse_credit') {
      const originalTransactionId = body.original_transaction_id?.trim() ?? ''
      if (!originalTransactionId) return jsonResponse({ error: '资格冲正必须指定原正向积分交易。', code: 'invalid_reversal' }, 400)
      return jsonResponse(await reverseQualificationCredit({
        userId: body.user_id,
        originalTransactionId,
        amount,
        reason,
        idempotencyKey: body.idempotency_key,
        adminUsername: authentication.username,
      }))
    }
    const referenceId = randomUUID()
    const requestHash = createBalanceRequestHash({
      userId: body.user_id,
      operation: body.operation,
      amount,
      reason,
      adminUsername: authentication.username,
    })
    return jsonResponse(await adjustBalance({
      userId: body.user_id,
      kind: body.operation === 'debit' ? 'admin_debit' : 'admin_credit',
      amount,
      referenceType: 'admin_adjustment',
      referenceId,
      idempotencyKey: body.idempotency_key,
      adminUsername: authentication.username,
      reason,
      requestHash,
    }))
  } catch (error) {
    if (error instanceof BalanceError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('admin balance error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
