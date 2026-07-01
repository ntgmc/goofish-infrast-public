import type { Context } from '@netlify/functions'
import {
  checkAdvancedOperatorUpdateLimit,
  consumeOperatorUpdateGrant,
  findCdkRecordByLicenseOrderHash,
  formatRiskFreezeMessage,
  getOperatorUpdateGrant,
  hasOperatorUpdateGrant,
  jsonResponse,
  normalizePermissionMode,
  recordAdvancedOperatorUpdate,
  reissueSignedLicenseFile,
  requireEnv,
  syncAdvancedCdkBinding,
  validateLicenseForRequest,
  validateOperators,
  verifyLicenseSignature,
} from './license-utils'
import type { OperatorUpdateGrant } from '../../src/lib/types'

const PERMISSION_LABELS: Record<string, string> = {
recommended: '单次重置卡',
growth: '练度提升卡',
advanced: '单账号终身卡',
ultimate: 'Admin卡',
admin: 'Admin卡',
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json() as { license?: unknown; operators?: unknown; activation_token?: unknown }
    const licenseCheck = validateLicenseForRequest(body.license)
    if (licenseCheck.ok === false) {
      return jsonResponse({ error: licenseCheck.message }, 400)
    }

    const adminSecret = requireEnv('MAA_ADMIN_SECRET')
    if (!verifyLicenseSignature(licenseCheck.license, adminSecret)) {
      return jsonResponse({ error: '授权签名无效。' }, 401)
    }

    const cdkRecord = await findCdkRecordByLicenseOrderHash(licenseCheck.license.order_hash)
    if (cdkRecord?.status === 'revoked') {
      return jsonResponse({ error: '授权已撤销，请联系卖家。' }, 403)
    }
    if (cdkRecord?.status === 'frozen') {
      return jsonResponse({ error: formatRiskFreezeMessage(cdkRecord.freeze_reason || '授权已触发风控冻结，请联系卖家人工核验。'), risk_status: 'frozen' }, 403)
    }

    const filePermission = normalizePermissionMode(licenseCheck.license.permission)
    const effectivePermission = normalizePermissionMode(cdkRecord?.permission ?? licenseCheck.license.permission)
    let effectiveCdkRecord = cdkRecord
    if (effectivePermission === 'advanced' && effectiveCdkRecord && body.operators === undefined) {
      const binding = await syncAdvancedCdkBinding(effectiveCdkRecord, licenseCheck.license.operators, req, body.activation_token)
      if (!binding.ok) {
        return jsonResponse({ error: binding.message, risk_status: binding.record.status === 'frozen' ? 'frozen' : 'ok' }, binding.status)
      }
      effectiveCdkRecord = binding.record
    }
    const operatorUpdateGrant = getOperatorUpdateGrant(effectiveCdkRecord)
    const advancedUpdateLimit = effectivePermission === 'advanced' && effectiveCdkRecord
      ? checkAdvancedOperatorUpdateLimit(effectiveCdkRecord).limit
      : undefined

    if (body.operators !== undefined) {
      const operatorsCheck = validateOperators(body.operators)
      if (!operatorsCheck.ok) {
        return jsonResponse({ error: operatorsCheck.message }, 400)
      }
      const canUpdateOperators = (effectivePermission === 'advanced' && Boolean(effectiveCdkRecord))
        || effectivePermission === 'admin'
        || hasOperatorUpdateGrant(effectiveCdkRecord)
      if (!canUpdateOperators) {
        return jsonResponse({ error: '当前授权没有可用的干员数据更新权限。' }, 403)
      }

      let nextOperatorUpdateGrant = null
      let nextUpdateLimit = advancedUpdateLimit
      if (effectivePermission === 'advanced' && effectiveCdkRecord) {
        const updateCheck = await recordAdvancedOperatorUpdate(effectiveCdkRecord, operatorsCheck.operators, req, body.activation_token)
        if (!updateCheck.ok) {
          return jsonResponse({
            error: updateCheck.message,
            risk_status: updateCheck.record.status === 'frozen' ? 'frozen' : 'ok',
            operator_update_limit: updateCheck.limit,
            operator_update_next_available_at: updateCheck.limit?.next_available_at,
          }, updateCheck.status)
        }
        effectiveCdkRecord = updateCheck.record
        nextUpdateLimit = updateCheck.limit
      } else if (effectiveCdkRecord && effectivePermission !== 'admin') {
        effectiveCdkRecord = await consumeOperatorUpdateGrant(effectiveCdkRecord, operatorsCheck.operators.length)
        nextOperatorUpdateGrant = getOperatorUpdateGrant(effectiveCdkRecord)
      }

      const reissued = reissueSignedLicenseFile(licenseCheck.license, effectivePermission, adminSecret, {
        operators: operatorsCheck.operators,
        operatorUpdateGrant: nextOperatorUpdateGrant,
      })

      return jsonResponse({
        permission: effectivePermission,
        permission_label: PERMISSION_LABELS[effectivePermission] ?? effectivePermission,
        status: effectiveCdkRecord?.status ?? null,
        risk_status: 'ok',
        operator_update_available: effectivePermission === 'advanced' ? Boolean(effectiveCdkRecord) : Boolean(nextOperatorUpdateGrant),
        operator_update_limit: nextUpdateLimit,
        operator_update_next_available_at: nextUpdateLimit?.next_available_at,
        license: reissued.license,
        license_file_content: reissued.licenseFileContent,
      })
    }

    const shouldReissue = effectivePermission !== filePermission
      || !isSameOperatorUpdateGrant(licenseCheck.license.operator_update_grant, operatorUpdateGrant)
    const reissued = shouldReissue
      ? reissueSignedLicenseFile(licenseCheck.license, effectivePermission, adminSecret, {
        operatorUpdateGrant,
      })
      : null

    return jsonResponse({
      permission: effectivePermission,
      permission_label: PERMISSION_LABELS[effectivePermission] ?? effectivePermission,
      status: effectiveCdkRecord?.status ?? null,
      risk_status: 'ok',
      operator_update_available: effectivePermission === 'advanced' ? Boolean(effectiveCdkRecord) : Boolean(operatorUpdateGrant),
      operator_update_limit: advancedUpdateLimit,
      operator_update_next_available_at: advancedUpdateLimit?.next_available_at,
      license: reissued?.license ?? null,
      license_file_content: reissued?.licenseFileContent ?? null,
    })
  } catch (error) {
    console.error('license status error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function isSameOperatorUpdateGrant(
  current: OperatorUpdateGrant | null | undefined,
  next: OperatorUpdateGrant | null,
): boolean {
  if (!current && !next) return true
  if (!current || !next) return false
  return current.remaining === next.remaining && current.granted_at === next.granted_at
}
