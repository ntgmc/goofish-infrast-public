import type { Context } from '@netlify/functions'
import {
  consumeOperatorUpdateGrant,
  findCdkRecordByLicenseOrderHash,
  getOperatorUpdateGrant,
  hasOperatorUpdateGrant,
  jsonResponse,
  normalizePermissionMode,
  reissueSignedLicenseFile,
  requireEnv,
  validateLicenseForRequest,
  validateOperators,
  verifyLicenseSignature,
} from './license-utils'
import type { OperatorUpdateGrant } from '../../src/lib/types'

const PERMISSION_LABELS: Record<string, string> = {
  recommended: '推荐版',
  growth: '成长版',
  advanced: '进阶版',
  ultimate: '尊享版',
  admin: 'Admin',
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json() as { license?: unknown; operators?: unknown }
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

    const filePermission = normalizePermissionMode(licenseCheck.license.permission)
    const effectivePermission = normalizePermissionMode(cdkRecord?.permission ?? licenseCheck.license.permission)
    const operatorUpdateGrant = getOperatorUpdateGrant(cdkRecord)

    if (body.operators !== undefined) {
      const operatorsCheck = validateOperators(body.operators)
      if (!operatorsCheck.ok) {
        return jsonResponse({ error: operatorsCheck.message }, 400)
      }
      const canUpdateOperators = effectivePermission === 'admin' || hasOperatorUpdateGrant(cdkRecord)
      if (!canUpdateOperators) {
        return jsonResponse({ error: '当前授权没有可用的干员数据更新权限。' }, 403)
      }

      const reissued = reissueSignedLicenseFile(licenseCheck.license, effectivePermission, adminSecret, {
        operators: operatorsCheck.operators,
        operatorUpdateGrant: null,
      })
      if (cdkRecord && effectivePermission !== 'admin') {
        await consumeOperatorUpdateGrant(cdkRecord, operatorsCheck.operators.length)
      }

      return jsonResponse({
        permission: effectivePermission,
        permission_label: PERMISSION_LABELS[effectivePermission] ?? effectivePermission,
        status: cdkRecord?.status ?? null,
        operator_update_available: false,
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
      status: cdkRecord?.status ?? null,
      operator_update_available: Boolean(operatorUpdateGrant),
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
