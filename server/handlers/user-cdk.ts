import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { CdkAlreadyRedeemedError, createRequestHash, IdempotencyConflictError, redeemCdkAtomically } from '../storage/cdk-redemption'
import { grantItemInTransaction, InventoryError, listInventory } from '../storage/inventory-store'
import {
  findCdkRecordByCode,
  getCdkItemCode,
  getCdkItemExpiresAt,
  getCdkType,
  normalizeCode,
} from './license-utils'
import {
  buildAuthPayload,
  jsonResponse,
  redeemProfileCdk,
  requireUserSession,
  upgradePreviewProfileWithCdk,
} from './user-auth'

export default async function userCdkHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const body = await getValidatedJson(req, requestSchemas.cdkRedeem)
    const match = await findCdkRecordByCode(normalizeCode(body.cdk))
    if (!match) return jsonResponse({ error: 'CDK 不存在。', code: 'cdk_not_found' }, 404)
    const cdkType = getCdkType(match.record)
    const targetsExistingProfile = typeof body.profile_id === 'string' && Boolean(body.profile_id.trim())
    if (targetsExistingProfile && cdkType !== 'profile') {
      return jsonResponse({ error: '当前 CDK 不能用于升级档案。', code: 'cdk_type_mismatch' }, 409)
    }
    if (cdkType === 'balance') {
      return jsonResponse({ error: '该 CDK 是积分兑换码，请前往积分页兑换。', code: 'cdk_type_mismatch', target: '/tool/balance' }, 409)
    }
    if (cdkType === 'profile') {
      const redeemed = targetsExistingProfile
        ? await upgradePreviewProfileWithCdk(auth.user, body.profile_id, body.cdk, body.display_name, body.note, body.idempotency_key)
        : await redeemProfileCdk(auth.user, body.cdk, body.display_name, body.note, body.idempotency_key)
      if (!redeemed.ok) return jsonResponse({ error: redeemed.message, code: 'profile_cdk_redeem_failed' }, redeemed.status)
      return jsonResponse({
        redemption_type: 'profile',
        auth: await buildAuthPayload(auth.user, redeemed.profile.id),
      })
    }

    const itemCode = getCdkItemCode(match.record)
    if (!itemCode) return jsonResponse({ error: '该道具 CDK 使用旧版载荷，暂不支持兑换。', code: 'cdk_payload_unsupported' }, 409)
    const requestHash = createRequestHash({ codeHash: match.codeHash, userId: auth.user.id, itemCode })
    const redeemed = await redeemCdkAtomically({
      key: match.key,
      idempotencyKey: body.idempotency_key,
      idempotencyScope: `item:${auth.user.id}`,
      requestHash,
      complete: async (client, record) => {
        if (getCdkType(record) !== 'item' || getCdkItemCode(record) !== itemCode) {
          throw new InventoryError('cdk_type_mismatch', '该 CDK 不是可兑换的道具 CDK。', 409)
        }
        const expiresAt = getCdkItemExpiresAt(record)
        if (expiresAt && Date.now() >= Date.parse(expiresAt)) {
          throw new InventoryError('cdk_item_expired', '该限时 CDK 的兑换期限已过。', 409)
        }
        const redeemedAt = new Date().toISOString()
        await grantItemInTransaction(client, {
          userId: auth.user.id,
          itemCode,
          quantity: 1,
          expiry: { mode: 'never' },
          expiresAt,
          sourceType: 'item_cdk',
          sourceId: match.codeHash,
          recipientRole: 'redeemer',
          metadata: { cdk_type: 'item', item_code: itemCode },
          now: redeemedAt,
        })
        return {
          record: { ...record, status: 'used' as const, used_at: redeemedAt, account_id: auth.user.id, profile_id: null },
          response: {
            redemption_type: 'inventory' as const,
            item: {
              code: itemCode,
              name: itemCode === 'lifetime_profile_voucher' ? '终身版兑换 CDK' : '限时 CDK',
              quantity: 1 as const,
              expires_at: expiresAt,
            },
          },
        }
      },
    })
    return jsonResponse({
      ...redeemed.response,
      inventory: await listInventory(auth.user.id),
      replayed: redeemed.replayed,
    })
  } catch (error) {
    if (error instanceof InventoryError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    if (error instanceof CdkAlreadyRedeemedError) return jsonResponse({ error: 'CDK 已被兑换或正在兑换。', code: 'cdk_already_redeemed' }, 409)
    if (error instanceof IdempotencyConflictError) return jsonResponse({ error: '当前请求标识已用于其他兑换请求。', code: 'idempotency_conflict' }, 409)
    console.error('user cdk error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
