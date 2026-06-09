import type { Context } from '@netlify/functions'
import {
  generateCdk,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  requireEnv,
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
    const { admin_password, permission, order_note } = await req.json() as {
      admin_password?: string;
      permission?: string;
      order_note?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
    const hashSecret = requireEnv('CDK_HASH_SECRET')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: '管理口令错误。' }, 401)
    }
    if (permission !== 'basic' && permission !== 'premium') {
      return jsonResponse({ error: 'CDK 类型必须是 basic 或 premium。' }, 400)
    }

    const store = await getCdkRecordStore()
    let code = generateCdk()
    let codeHash = hashCdk(code, hashSecret)
    let key = `cdk/${codeHash}.json`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await store.get(key)
      if (!existing) break
      code = generateCdk()
      codeHash = hashCdk(code, hashSecret)
      key = `cdk/${codeHash}.json`
    }

    const createdAt = new Date().toISOString()
    const record: CdkRecord = {
      version: 1,
      code_hash: codeHash,
      permission,
      status: 'unused',
      created_at: createdAt,
      used_at: null,
      order_note: order_note?.trim() || null,
      license_order_hash: null,
      operator_count: null,
      config_desc: null,
    }
    await store.set(key, record)

    return jsonResponse({ code, permission, created_at: createdAt })
  } catch (error) {
    console.error('admin cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
