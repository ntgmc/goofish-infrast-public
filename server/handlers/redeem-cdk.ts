import {
  createAdvancedRiskBinding,
  createSignedLicenseFile,
  findCdkRecordByCode,
  jsonResponse,
  normalizePermissionMode,
  normalizeCode,
  requireEnv,
  resolveConfigForPermission,
  validateConfig,
  validateOperators,
} from './license-utils'
import { recordUsageEvent } from './usage-stats'
import type { UsageReasonCode } from '../storage/usage-store'
import { CdkAlreadyRedeemedError, IdempotencyConflictError, createRequestHash, redeemCdkAtomically } from '../storage/cdk-redemption'
import { getPermissionProfile } from '../../src/lib/product-catalog'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const startedAt = Date.now()
  try {
    const body = await req.json() as {
      code?: string;
      validate_only?: boolean;
      operators?: unknown;
      config?: unknown;
      activation_token?: unknown;
    }

    if (!body.code || typeof body.code !== 'string') {
      await recordCdkRedeem('failure', 'validation_failed', startedAt)
      return jsonResponse({ error: '请填写 CDK。' }, 400)
    }
    if (body.validate_only) {
      return validateCdkCode(body.code)
    }
    const operatorsCheck = validateOperators(body.operators)
    if (!operatorsCheck.ok) {
      await recordCdkRedeem('failure', 'validation_failed', startedAt)
      return jsonResponse({ error: operatorsCheck.message }, 400)
    }
    const configCheck = validateConfig(body.config)
    if (!configCheck.ok) {
      await recordCdkRedeem('failure', 'validation_failed', startedAt)
      return jsonResponse({ error: configCheck.message }, 400)
    }

    const adminSecret = requireEnv('MAA_ADMIN_SECRET')
    const cdkMatch = await findCdkRecordByCode(normalizeCode(body.code))
    const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'))

    if (!cdkMatch) {
      await recordCdkRedeem('failure', 'cdk_missing', startedAt, undefined, 'missing')
      return jsonResponse({ error: 'CDK 不存在。' }, 404)
    }
    const { codeHash, key, record: existing } = cdkMatch
    if (!idempotencyKey && (existing.status === 'used' || existing.status === 'frozen')) {
      await recordCdkRedeem('failure', existing.status === 'frozen' ? 'cdk_frozen' : 'cdk_used', startedAt, existing.permission, existing.status)
      return jsonResponse({ error: 'CDK 已使用。' }, 409)
    }
    if (!idempotencyKey && existing.status !== 'unused') {
      await recordCdkRedeem('failure', 'cdk_status_invalid', startedAt, existing.permission, existing.status)
      return jsonResponse({ error: 'CDK 状态不正确。' }, 409)
    }
    const permission = normalizePermissionMode(existing.permission)
    const configForPermission = resolveConfigForPermission(permission, configCheck.config)
    if (!configForPermission.ok) {
      await recordCdkRedeem('failure', 'permission_denied', startedAt, permission, existing.status)
      return jsonResponse({ error: configForPermission.message }, 403)
    }

    const redeemed = await redeemCdkAtomically({
      key,
      idempotencyKey,
      idempotencyScope: 'license-file',
      requestHash: createRequestHash({ codeHash, operators: operatorsCheck.operators, config: configForPermission.config, activationToken: body.activation_token ?? null }),
      complete: async (_client, claimed) => {
        const { license, licenseFileContent } = createSignedLicenseFile({
          adminSecret,
          operators: operatorsCheck.operators,
          config: configForPermission.config,
          permission,
          codeHash,
          activationToken: body.activation_token,
        })
        let updated: CdkRecord = {
          ...claimed,
          status: 'used',
          used_at: new Date().toISOString(),
          license_order_hash: license.order_hash,
          operator_count: operatorsCheck.operators.length,
          config_desc: configForPermission.config.desc || configForPermission.config.layout || null,
        }
        if (permission === 'advanced') {
          const binding = await createAdvancedRiskBinding(updated, operatorsCheck.operators, req, body.activation_token)
          if (!binding.ok) throw new Error(binding.event.reason)
          updated = binding.record
        }
        return { record: updated, response: { license_file_content: licenseFileContent, license } }
      },
    })
    await recordCdkRedeem('success', 'ok', startedAt, permission, 'used')
    return jsonResponse(redeemed.response)
  } catch (error) {
    console.error('redeem cdk error:', error)
    await recordCdkRedeem('failure', 'unknown_failure', startedAt)
    if (error instanceof CdkAlreadyRedeemedError) return jsonResponse({ error: error.message }, 409)
    if (error instanceof IdempotencyConflictError) return jsonResponse({ error: error.message }, 409)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function normalizeIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? ''
  return key && key.length <= 200 ? key : null
}

async function recordCdkRedeem(
  status: 'success' | 'failure',
  reasonCode: UsageReasonCode,
  startedAt: number,
  permission?: string,
  cdkStatus?: string,
): Promise<void> {
  try {
    await recordUsageEvent('cdk_redeem', {
      status,
      reason_code: reasonCode,
      duration_ms: Date.now() - startedAt,
      permission,
      cdk_status: cdkStatus,
      source: 'redeem_cdk',
    })
  } catch (error) {
    console.warn('usage stats cdk redeem skipped:', error)
  }
}

async function validateCdkCode(code: string): Promise<Response> {
  try {
    if (!code || !code.trim()) {
      return jsonResponse({ error: '请填写 CDK。' }, 400)
    }
    const match = await findCdkRecordByCode(code)
    if (!match) {
      return jsonResponse({ error: 'CDK 不存在。' }, 404)
    }
    const record = match.record
    if (record.status === 'used' || record.status === 'frozen') {
      return jsonResponse({ error: 'CDK 已使用。' }, 409)
    }
    if (record.status !== 'unused') {
      return jsonResponse({ error: 'CDK 状态不正确。' }, 409)
    }
    const permission = normalizePermissionMode(record.permission)
    return jsonResponse({
      ok: true,
      permission,
      permission_label: getPermissionProfile(permission).label,
    })
  } catch (error) {
    console.error('validate cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
