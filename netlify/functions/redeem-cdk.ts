import type { Context } from '@netlify/functions'
import {
  createSignedLicenseFile,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  normalizeCode,
  requireEnv,
  validateConfig,
  validateOperators,
  type CdkRecord,
} from './license-utils'

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
      operators?: unknown;
      config?: unknown;
    }

    if (!body.code || typeof body.code !== 'string') {
      return jsonResponse({ error: '请填写 CDK。' }, 400)
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
    if (existing.status === 'used') {
      return jsonResponse({ error: 'CDK 已使用。' }, 409)
    }
    if (existing.status !== 'unused') {
      return jsonResponse({ error: 'CDK 状态不正确。' }, 409)
    }

    const { license, licenseFileContent } = createSignedLicenseFile({
      adminSecret,
      operators: operatorsCheck.operators,
      config: configCheck.config,
      permission: existing.permission,
      codeHash,
    })

    const updated: CdkRecord = {
      ...existing,
      status: 'used',
      used_at: new Date().toISOString(),
      license_order_hash: license.order_hash,
      operator_count: operatorsCheck.operators.length,
      config_desc: configCheck.config.desc || configCheck.config.layout || null,
    }
    await store.set(key, updated)

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
