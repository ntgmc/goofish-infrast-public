import type { Context } from '@netlify/functions'
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

const PERMISSION_LABELS: Record<string, string> = {
  recommended: '推荐版',
  growth: '成长版',
  advanced: '单账号终身版',
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
    const body = await req.json() as {
      code?: string;
      validate_only?: boolean;
      operators?: unknown;
      config?: unknown;
      activation_token?: unknown;
    }

    if (!body.code || typeof body.code !== 'string') {
      return jsonResponse({ error: '请填写 CDK。' }, 400)
    }
    if (body.validate_only) {
      return validateCdkCode(body.code)
    }
    const operatorsCheck = validateOperators(body.operators)
    if (!operatorsCheck.ok) {
      return jsonResponse({ error: operatorsCheck.message }, 400)
    }
    const configCheck = validateConfig(body.config)
    if (!configCheck.ok) {
      return jsonResponse({ error: configCheck.message }, 400)
    }

    const hashSecret = requireEnv('CDK_HASH_SECRET')
    const adminSecret = requireEnv('MAA_ADMIN_SECRET')
    const codeHash = hashCdk(normalizeCode(body.code), hashSecret)
    const key = `cdk/${codeHash}.json`
    const store = await getCdkRecordStore()
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK 不存在。' }, 404)
    }
    if (existing.status === 'used' || existing.status === 'frozen') {
      return jsonResponse({ error: 'CDK 已使用。' }, 409)
    }
    if (existing.status !== 'unused') {
      return jsonResponse({ error: 'CDK 状态不正确。' }, 409)
    }
    const permission = normalizePermissionMode(existing.permission)
    const configForPermission = resolveConfigForPermission(permission, configCheck.config)
    if (!configForPermission.ok) {
      return jsonResponse({ error: configForPermission.message }, 403)
    }

    const { license, licenseFileContent } = createSignedLicenseFile({
      adminSecret,
      operators: operatorsCheck.operators,
      config: configForPermission.config,
      permission,
      codeHash,
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
      const binding = createAdvancedRiskBinding(updated, operatorsCheck.operators, req, body.activation_token)
      if (!binding.ok) {
        return jsonResponse({ error: binding.event.reason }, 400)
      }
      updated = binding.record
    }
    await store.set(key, updated)
    await recordCdkRedeem()

    return jsonResponse({
      license_file_content: licenseFileContent,
      license,
    })
  } catch (error) {
    console.error('redeem cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function recordCdkRedeem(): Promise<void> {
  try {
    await recordUsageEvent('cdk_redeem')
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
