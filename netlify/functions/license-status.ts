import type { Context } from '@netlify/functions'
import {
  findCdkRecordByLicenseOrderHash,
  jsonResponse,
  normalizePermissionMode,
  reissueSignedLicenseFile,
  requireEnv,
  validateLicenseForRequest,
  verifyLicenseSignature,
} from './license-utils'

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
    const body = await req.json() as { license?: unknown }
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
    const shouldReissue = effectivePermission !== filePermission
    const reissued = shouldReissue
      ? reissueSignedLicenseFile(licenseCheck.license, effectivePermission, adminSecret)
      : null

    return jsonResponse({
      permission: effectivePermission,
      permission_label: PERMISSION_LABELS[effectivePermission] ?? effectivePermission,
      status: cdkRecord?.status ?? null,
      license: reissued?.license ?? null,
      license_file_content: reissued?.licenseFileContent ?? null,
    })
  } catch (error) {
    console.error('license status error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
