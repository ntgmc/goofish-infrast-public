import {
  checkAdvancedOperatorUpdateLimit,
  consumeOperatorUpdateGrant,
  findCdkRecordByLicenseOrderHash,
  formatRiskFreezeMessage,
  getOperatorUpdateGrant,
  jsonResponse,
  normalizePermissionMode,
  recordAdvancedOperatorUpdate,
  reissueSignedLicenseFile,
  requireEnv,
  syncAdvancedCdkBinding,
  validateLicenseForRequest,
  validateOperators,
  verifyLicenseSignatureWithKeyring,
  type CdkRecord,
} from './license-utils'
import type { OperatorUpdateGrant } from '../../src/lib/types'
import { getProfileForUser, saveUserProfile, type UserGameAccountRecord } from '../storage/user-store'
import { getPermissionProfile, hasCapability } from '../../src/lib/product-catalog'

export default async (req: Request): Promise<Response> => {
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

    if (!verifyLicenseSignatureWithKeyring(licenseCheck.license)) {
      return jsonResponse({ error: '授权签名无效。' }, 401)
    }
    const adminSecret = requireEnv('MAA_ADMIN_SECRET')

    const cdkRecord = await findCdkRecordByLicenseOrderHash(licenseCheck.license.order_hash)
    if (cdkRecord?.status === 'revoked') {
      return jsonResponse({ error: '授权已撤销，请联系卖家。' }, 403)
    }
    if (cdkRecord?.status === 'frozen') {
      return jsonResponse({ error: formatRiskFreezeMessage(cdkRecord.freeze_reason || '授权已触发风控冻结，请联系卖家人工核验。'), risk_status: 'frozen' }, 403)
    }
    const boundProfile = cdkRecord ? await getCdkBoundProfile(cdkRecord) : null
    if (boundProfile?.status === 'frozen') {
      return jsonResponse({ error: '当前账号档案已触发干员数据风控冻结，请联系卖家人工核验。', risk_status: 'frozen' }, 403)
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
      const canUpdateOperators = hasCapability({
        permission: effectivePermission,
        hasActiveCdkRecord: Boolean(effectiveCdkRecord),
        operatorUpdateGrantRemaining: getOperatorUpdateGrant(effectiveCdkRecord)?.remaining,
      }, 'replace_operator_data')
      if (!canUpdateOperators) {
        return jsonResponse({ error: '当前授权没有可用的干员数据更新权限。' }, 403)
      }

      let nextOperatorUpdateGrant: OperatorUpdateGrant | null = null
      let nextUpdateLimit = advancedUpdateLimit
      if (effectivePermission === 'advanced' && effectiveCdkRecord) {
      const updateCheck = await recordAdvancedOperatorUpdate(effectiveCdkRecord, operatorsCheck.operators, req, body.activation_token)
      if (!updateCheck.ok) {
        const profileFrozen = updateCheck.profile_freeze_required ? await freezeCdkBoundProfile(updateCheck.record) : false
        return jsonResponse({
          error: updateCheck.message,
          risk_status: updateCheck.record.status === 'frozen' || profileFrozen ? 'frozen' : 'ok',
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
        activationToken: body.activation_token,
      })

      return jsonResponse({
        permission: effectivePermission,
        permission_label: getPermissionProfile(effectivePermission).label,
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
    || hasDifferentActivationToken(licenseCheck.license.activation_token, body.activation_token)
  const reissued = shouldReissue
    ? reissueSignedLicenseFile(licenseCheck.license, effectivePermission, adminSecret, {
        operatorUpdateGrant,
        activationToken: body.activation_token,
      })
    : null

    return jsonResponse({
      permission: effectivePermission,
      permission_label: getPermissionProfile(effectivePermission).label,
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

async function getCdkBoundProfile(record: CdkRecord): Promise<UserGameAccountRecord | null> {
  if (!record.account_id || !record.profile_id) return null
  return getProfileForUser(record.account_id, record.profile_id)
}

async function freezeCdkBoundProfile(record: CdkRecord): Promise<boolean> {
  const profile = await getCdkBoundProfile(record)
  if (!profile) return false
  if (profile.status === 'frozen') return true
  await saveUserProfile({
    ...profile,
    status: 'frozen',
    updated_at: new Date().toISOString(),
  })
  return true
}

function isSameOperatorUpdateGrant(
  current: OperatorUpdateGrant | null | undefined,
  next: OperatorUpdateGrant | null,
): boolean {
  if (!current && !next) return true
  if (!current || !next) return false
  return current.remaining === next.remaining && current.granted_at === next.granted_at
}

function hasDifferentActivationToken(current: unknown, next: unknown): boolean {
  const nextToken = normalizeActivationToken(next)
  if (!nextToken) return false
  return normalizeActivationToken(current) !== nextToken
}

function normalizeActivationToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return token.length >= 16 ? token : null
}
