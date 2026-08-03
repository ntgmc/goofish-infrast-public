import { normalizePointsAmount } from '../../src/lib/balance-contracts'
import {
  applyBalanceChangeInTransaction,
  BalanceError,
  createBalanceRequestHash,
  getPublicBalancePage,
  toPublicBalanceTransaction,
} from '../storage/balance-store'
import { CdkAlreadyRedeemedError, IdempotencyConflictError, redeemCdkAtomically } from '../storage/cdk-redemption'
import { getCdkBalanceAmount, getCdkType, findCdkRecordByCode, normalizeCode } from './license-utils'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userBalanceHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/redeem')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await getValidatedJson(req, requestSchemas.balanceRedeem)
      const match = await findCdkRecordByCode(normalizeCode(body.cdk))
      if (!match) return jsonResponse({ error: 'CDK 不存在。', code: 'cdk_not_found' }, 404)
      const cdkType = getCdkType(match.record)
      if (cdkType === 'item') return jsonResponse({ error: '该 CDK 是道具兑换码，请前往兑换页使用。', code: 'cdk_type_mismatch', target: '/tool/redeem' }, 409)
      if (cdkType !== 'balance') return jsonResponse({ error: '该 CDK 只能用于兑换档案。', code: 'cdk_type_mismatch' }, 409)
      const amount = normalizePointsAmount(getCdkBalanceAmount(match.record))
      if (!amount) return jsonResponse({ error: '余额 CDK 面额无效。', code: 'invalid_cdk_amount' }, 409)
      const requestHash = createBalanceRequestHash({ codeHash: match.codeHash, userId: auth.user.id })
      const redeemed = await redeemCdkAtomically({
        key: match.key,
        idempotencyKey: body.idempotency_key,
        idempotencyScope: `balance:${auth.user.id}`,
        requestHash,
        complete: async (client, record) => {
          const change = await applyBalanceChangeInTransaction(client, {
            userId: auth.user.id,
            kind: 'cdk_credit',
            amount,
            referenceType: 'balance_cdk',
            referenceId: match.codeHash,
            requestHash,
          })
          const now = new Date().toISOString()
          return {
            record: { ...record, status: 'used' as const, used_at: now, account_id: auth.user.id },
            response: {
              balance: { currency: 'points' as const, available: change.transaction.balance_after },
              transaction: toPublicBalanceTransaction(change.transaction),
              cdk: { cdk_type: 'balance' as const, amount },
            },
          }
        },
      })
      return jsonResponse({ ...redeemed.response, replayed: redeemed.replayed })
    }
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    const rawLimit = url.searchParams.get('limit')
    const limit = rawLimit === null ? undefined : Number(rawLimit)
    return jsonResponse(await getPublicBalancePage(auth.user.id, { cursor: url.searchParams.get('cursor'), limit }))
  } catch (error) {
    if (error instanceof BalanceError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    if (error instanceof CdkAlreadyRedeemedError) return jsonResponse({ error: 'CDK 已被兑换或正在兑换。', code: 'cdk_already_redeemed' }, 409)
    if (error instanceof IdempotencyConflictError) return jsonResponse({ error: '当前请求标识已用于其他兑换请求。', code: 'idempotency_conflict' }, 409)
    console.error('user balance error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
