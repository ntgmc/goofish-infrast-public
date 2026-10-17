import { createHash, randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import handler from './user-skland'
import { closePool, query } from '../storage/postgres'
import { ensureDatabaseSchema } from '../storage/schema'
import { getItemBalance, grantItem } from '../storage/inventory-store'
import { getProfileById, getProfileWorkspace, insertUserAccountForRegistration, saveUserProfile, saveUserSession, type UserGameAccountRecord } from '../storage/user-store'

let container: StartedPostgreSqlContainer
let userId: string
let uid: string
let tokenResponse: unknown
let pause: (() => Promise<void>) | undefined
const session = 'm'.repeat(43)

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  vi.stubEnv('SKLAND_CREDENTIAL_SECRET', 'skland-regression-fixture-secret')
  vi.stubEnv('FREE_PREVIEW_UID_HASH_SECRET', 'skland-regression-fixture-uid-secret')
  await ensureDatabaseSchema()
})
afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await closePool()
  await container.stop()
})
beforeEach(async () => {
  await query('truncate table user_accounts, cdk_records cascade')
  userId = randomUUID()
  uid = randomUUID()
  pause = undefined
  tokenResponse = { code: 0, message: 'OK', data: { token: 'fixture-token' } }
  const now = new Date().toISOString()
  await insertUserAccountForRegistration({ version: 1, id: userId, email: `${userId}@example.test`, password_hash: 'fixture', salt: 'fixture', iterations: 1,
    permission: 'advanced', status: 'active', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, email_verified_at: now, created_at: now, updated_at: now })
  await saveUserSession({ version: 1, id: randomUUID(), user_id: userId, token_hash: createHash('sha256').update(session).digest('hex'),
    created_at: now, last_seen_at: now, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(String(url)).pathname
    let data: unknown
    if (path.endsWith('/auth/refresh')) return Response.json(tokenResponse)
    if (path.endsWith('/player/binding')) data = { list: [{ appCode: 'arknights', defaultUid: uid, bindingList: [{ uid, nickName: 'Fixture', channelName: '官服' }] }] }
    else if (path.endsWith('/player/info')) {
      const gate = pause
      pause = undefined
      await gate?.()
      data = { chars: [{ charId: 'char_002_amiya', evolvePhase: 2, level: 80, potentialRank: 5 }], charInfoMap: { char_002_amiya: { name: '阿米娅', rarity: 4 } } }
    } else if (path.endsWith('/cultivate/info')) data = { items: { '3003': { name: '赤金' } } }
    else if (path.endsWith('/cultivate/player')) data = { items: [{ id: '3003', count: 123 }] }
    else throw new Error(`Unexpected fixture URL: ${path}`)
    return Response.json({ code: 0, message: 'OK', data })
  })
})

async function request(path: string, body: object) {
  const response = await handler(new Request(`http://localhost/api/user/skland${path}`, { method: 'POST',
    headers: { Cookie: `maa_session=${session}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}
async function profile(kind: UserGameAccountRecord['kind'] = 'cdk') {
  const now = new Date().toISOString()
  const value: UserGameAccountRecord = { version: 1, id: randomUUID(), user_id: userId, kind, authorization_source: 'admin_grant',
    cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, permission: 'advanced', status: 'active', display_name: 'Fixture', note: '', created_at: now, updated_at: now }
  await saveUserProfile(value)
  return value
}
function barrier() {
  const reached = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  pause = async () => { reached.resolve(); await released.promise }
  return { reached: reached.promise, release: released.resolve }
}
async function preview(suffix: string, profileId?: string) {
  return request(`${suffix}/credential/preview`, { credential_text: 'regression-fixture-cred', source: 'manual', ...(profileId && { profile_id: profileId }) })
}

it.each(['ordinary', 'replacement', 'lifetime'])('rejects %s confirmation after pending cancellation without saving or consuming', async (mode) => {
  const target = await profile()
  const suffix = mode === 'lifetime' ? '/lifetime-voucher' : ''
  if (suffix) await grantItem({ userId, itemCode: 'lifetime_profile_voucher', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: randomUUID(), recipientRole: 'test' })
  const first = await preview(suffix, suffix ? undefined : target.id)
  expect(first.status).toBe(200)
  const gate = barrier()
  const slow = request(`${suffix}/login/confirm`, { confirmation_id: first.body.confirmation_id, idempotency_key: randomUUID(), ...(!suffix && { profile_id: target.id }) })
  try {
    await gate.reached
    expect((await request(`${suffix}/pending/cancel`, { pending_id: first.body.confirmation_id, ...(!suffix && { profile_id: target.id }) })).status).toBe(204)
    let replacement: string | undefined
    if (mode === 'replacement') replacement = (await preview('', target.id)).body.confirmation_id
    gate.release()
    expect((await slow).status).toBe(400)
    expect((await getProfileById(target.id))?.skland_binding).toBeFalsy()
    expect((await getProfileWorkspace(target.id))?.operators ?? []).toEqual([])
    if (replacement) expect((await getProfileById(target.id))?.skland_pending_binding?.confirmation_id).toBe(replacement)
    if (suffix) expect(await getItemBalance(userId, 'lifetime_profile_voucher')).toBe(1)
  } finally { gate.release(); await slow }
})

it('preserves a concurrent freeze and refuses to upgrade the frozen UID with a voucher', async () => {
  const target = await profile('free_preview')
  const gate = barrier()
  const slow = preview('', target.id)
  try {
    await gate.reached
    await saveUserProfile({ ...target, status: 'frozen', note: 'admin freeze' })
    gate.release()
    expect((await slow).status).toBe(200)
    expect(await getProfileById(target.id)).toMatchObject({ status: 'frozen', note: 'admin freeze' })
  } finally { gate.release(); await slow }
  const pending = (await getProfileById(target.id))!.skland_pending_binding!
  await saveUserProfile({ ...(await getProfileById(target.id))!, skland_binding: { uid, nickname: 'Fixture', channel_name: '官服', bound_at: target.created_at,
    last_imported_at: target.created_at, encrypted_cred: pending.encrypted_cred, credential_status: 'available' } })
  await grantItem({ userId, itemCode: 'lifetime_profile_voucher', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: randomUUID(), recipientRole: 'test' })
  const next = await preview('/lifetime-voucher')
  expect(next.status).toBe(200)
  const confirmed = await request('/lifetime-voucher/login/confirm', { confirmation_id: next.body.confirmation_id, idempotency_key: randomUUID() })
  expect(confirmed.status).toBe(409)
  expect(await getProfileById(target.id)).toMatchObject({ status: 'frozen', kind: 'free_preview' })
  expect(await getItemBalance(userId, 'lifetime_profile_voucher')).toBe(1)
  await saveUserProfile({ ...(await getProfileById(target.id))!, status: 'active' })
  expect((await request('/lifetime-voucher/login/confirm', { confirmation_id: next.body.confirmation_id, idempotency_key: randomUUID() })).status).toBe(200)
  expect(await getProfileById(target.id)).toMatchObject({ id: target.id, kind: 'cdk', status: 'active' })
  expect(await getItemBalance(userId, 'lifetime_profile_voucher')).toBe(0)
})

it.each([{ code: 500, message: 'Service temporarily unavailable' }, { code: 0, message: 'OK', data: {} }, null])('preserves bound credentials on token response %j', async (failure) => {
  const target = await profile()
  const first = await preview('', target.id)
  expect((await request('/login/confirm', { profile_id: target.id, confirmation_id: first.body.confirmation_id, idempotency_key: randomUUID() })).status).toBe(200)
  tokenResponse = failure
  const cached = await request('/import/refresh', { profile_id: target.id })
  expect(cached.status).toBe(200)
  expect(cached.body.skland_import.inventory_warning).toBeTruthy()
  await query('delete from skland_snapshots where user_id = $1', [userId])
  expect((await request('/import/refresh', { profile_id: target.id })).body.code).toBe('skland_upstream_failed')
  expect((await getProfileById(target.id))?.skland_binding?.credential_status).toBe('available')
  await query('delete from skland_snapshots where user_id = $1', [userId])
  tokenResponse = { code: 401, message: 'Unauthorized' }
  expect((await request('/import/refresh', { profile_id: target.id })).body.code).toBe('skland_credential_invalid')
})
