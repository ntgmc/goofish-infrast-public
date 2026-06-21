import type { Context } from '@netlify/functions'
import {
  generateCdk,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  requireEnv,
  type CdkRecord,
  type CdkStatus,
} from './license-utils'

type CdkStatusFilter = CdkStatus | 'all'

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
  if (req.method === 'GET') {
    return handleList(req)
  }
  if (req.method === 'DELETE') {
    return handleDelete(req)
  }
  if (req.method === 'PATCH') {
    return handlePatch(req)
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
    if (permission !== 'basic' && permission !== 'premium' && permission !== 'admin') {
      return jsonResponse({ error: 'CDK 类型必须是 basic、premium 或 admin。' }, 400)
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
      revoked_at: null,
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

async function handleList(req: Request): Promise<Response> {
  try {
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
    const providedPassword = req.headers.get('X-Admin-Password')
    if (providedPassword !== adminPassword) {
      return jsonResponse({ error: '管理口令错误。' }, 401)
    }

    const status = normalizeStatusFilter(req.headers.get('X-Cdk-Status'), req.url)
    const store = await getCdkRecordStore()
    const records = (await store.list('cdk/'))
      .filter((record) => status === 'all' || record.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))

    return jsonResponse({
      status,
      total: records.length,
      cdks: records.map(toAdminCdkRecord),
    })
  } catch (error) {
    console.error('admin cdk list error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handlePatch(req: Request): Promise<Response> {
  try {
    const { admin_password, code_hash, action } = await req.json() as {
      admin_password?: string;
      code_hash?: string;
      action?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: 'Invalid admin password.' }, 401)
    }
    if (action !== 'revoke') {
      return jsonResponse({ error: 'Unsupported action.' }, 400)
    }
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'Invalid CDK identifier.' }, 400)
    }

    const store = await getCdkRecordStore()
    const key = `cdk/${code_hash}.json`
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK not found.' }, 404)
    }
    if (existing.status === 'revoked') {
      return jsonResponse({
        revoked: true,
        already_revoked: true,
        cdk_id: existing.code_hash.slice(0, 12),
        revoked_at: existing.revoked_at ?? null,
      })
    }
    if (existing.status !== 'used') {
      return jsonResponse({ error: 'Only used CDKs can be revoked.' }, 409)
    }

    const revokedAt = new Date().toISOString()
    const updated: CdkRecord = {
      ...existing,
      status: 'revoked',
      revoked_at: revokedAt,
    }
    await store.set(key, updated)
    return jsonResponse({
      revoked: true,
      already_revoked: false,
      cdk_id: existing.code_hash.slice(0, 12),
      revoked_at: revokedAt,
    })
  } catch (error) {
    console.error('admin cdk revoke error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handleDelete(req: Request): Promise<Response> {
  try {
    const { admin_password, code_hash } = await req.json() as {
      admin_password?: string;
      code_hash?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: 'Invalid admin password.' }, 401)
    }
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'Invalid CDK identifier.' }, 400)
    }

    const store = await getCdkRecordStore()
    const key = `cdk/${code_hash}.json`
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK not found.' }, 404)
    }
    if (existing.status !== 'unused') {
      return jsonResponse({ error: 'Only unused CDKs can be deleted.' }, 409)
    }

    await store.delete(key)
    return jsonResponse({ deleted: true, cdk_id: existing.code_hash.slice(0, 12) })
  } catch (error) {
    console.error('admin cdk delete error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function normalizeStatusFilter(headerValue: string | null, requestUrl: string): CdkStatusFilter {
  if (headerValue === 'used' || headerValue === 'revoked' || headerValue === 'all') return headerValue
  const queryValue = new URL(requestUrl).searchParams.get('status')
  if (queryValue === 'used' || queryValue === 'revoked' || queryValue === 'all') return queryValue
  return 'unused'
}

function toAdminCdkRecord(record: CdkRecord) {
  return {
    code_hash: record.code_hash,
    cdk_id: record.code_hash.slice(0, 12),
    permission: record.permission,
    status: record.status,
    created_at: record.created_at,
    used_at: record.used_at,
    revoked_at: record.revoked_at ?? null,
    order_note: record.order_note,
    license_order_hash: record.license_order_hash,
    operator_count: record.operator_count,
    config_desc: record.config_desc,
  }
}
