import {
  createAdvancedRiskBinding,
  createSignedLicenseFile,
  findCdkRecordByCode,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  normalizePermissionMode,
  normalizeCode,
  requireEnv,
  resolveConfigForPermission,
  validateConfig,
  validateOperators,
  type CdkRecord,
} from './license-utils'
import { recordUsageEvent } from './usage-stats'
import type { UsageReasonCode } from '../storage/usage-store'

const PERMISSION_LABELS: Record<string, string> = {
recommended: '单次重置卡',
growth: '练度提升卡',
advanced: '单账号终身卡',
ultimate: 'Admin卡',
admin: 'Admin卡',
}

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

    const hashSecret = requireEnv('CDK_HASH_SECRET')
    const adminSecret = requireEnv('MAA_ADMIN_SECRET')
    const codeHash = hashCdk(normalizeCode(body.code), hashSecret)
    const key = `cdk/${codeHash}.json`
    const store = await getCdkRecordStore()
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      await recordCdkRedeem('failure', 'cdk_missing', startedAt, undefined, 'missing')
      return jsonResponse({ error: 'CDK 不存在。' }, 404)
    }
    if (existing.status === 'used' || existing.status === 'frozen') {
      await recordCdkRedeem('failure', existing.status === 'frozen' ? 'cdk_frozen' : 'cdk_used', startedAt, existing.permission, existing.status)
      return jsonResponse({ error: 'CDK 已使用。' }, 409)
    }
    if (existing.status !== 'unused') {
      await recordCdkRedeem('failure', 'cdk_status_invalid', startedAt, existing.permission, existing.status)
      return jsonResponse({ error: 'CDK 状态不正确。' }, 409)
    }
    const permission = normalizePermissionMode(existing.permission)
    const configForPermission = resolveConfigForPermission(permission, configCheck.config)
    if (!configForPermission.ok) {
      await recordCdkRedeem('failure', 'permission_denied', startedAt, permission, existing.status)
      return jsonResponse({ error: configForPermission.message }, 403)
    }

    const { license, licenseFileContent } = createSignedLicenseFile({
      adminSecret,
      operators: operatorsCheck.operators,
      config: configForPermission.config,
      permission,
      codeHash,
      activationToken: body.activation_token,
    })

    let updated: CdkRecord = {
      ...existing,
      status: 'used',
      used_at: new Date().toISOString(),
      license_order_hash: license.order_hash,
      operator_count: operatorsCheck.operators.length,
      config_desc: configForPermission.config.desc || configForPermission.config.layout || null,
    }

    if (permission === 'advanced') {
      const binding = await createAdvancedRiskBinding(updated, operatorsCheck.operators, req, body.activation_token)
      if (!binding.ok) {
        await recordCdkRedeem('failure', 'risk_soft_blocked', startedAt, permission, existing.status)
        return jsonResponse({ error: binding.event.reason }, 400)
      }
      updated = binding.record
    }
    await store.set(key, updated)
    await recordCdkRedeem('success', 'ok', startedAt, permission, updated.status)

    return jsonResponse({
      license_file_content: licenseFileContent,
      license,
    })
  } catch (error) {
    console.error('redeem cdk error:', error)
    await recordCdkRedeem('failure', 'unknown_failure', startedAt)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
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
    const hashSecret = requireEnv('CDK_HASH_SECRET')
    const record = await findCdkRecordByCode(code, hashSecret)
    if (!record) {
      return jsonResponse({ error: 'CDK 不存在。' }, 404)
    }
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
      permission_label: PERMISSION_LABELS[permission] ?? permission,
    })
  } catch (error) {
    console.error('validate cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
