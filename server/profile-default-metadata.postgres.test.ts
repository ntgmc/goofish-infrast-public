import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { upgradePreviewProfileWithCdk } from './handlers/user-auth'
import { hashCdk } from './handlers/license-utils'
import { createPostgresCdkRecordStore } from './storage/cdk-store'
import { closePool, query } from './storage/postgres'
import { ensureDatabaseSchema } from './storage/schema'
import { getProfileById, insertUserAccountForRegistration, saveUserProfile, type UserAccountRecord, type UserGameAccountRecord } from './storage/user-store'

let container: StartedPostgreSqlContainer
let user: UserAccountRecord
const run = promisify(execFile)

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  vi.stubEnv('CDK_HASH_SECRET', 'profile-metadata-regression-secret')
  await ensureDatabaseSchema()
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await closePool()
  if (container) await container.stop()
})
beforeEach(async () => {
  await query('truncate table user_accounts, cdk_records cascade')
  const now = new Date().toISOString()
  user = { version: 1, id: randomUUID(), email: `${randomUUID()}@example.test`, password_hash: 'hash', salt: 'salt', iterations: 1,
    permission: 'growth', status: 'active', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, email_verified_at: now, created_at: now, updated_at: now }
  await insertUserAccountForRegistration(user)
})

it.each([
  { name: '免费个人排班', note: '已绑定森空岛的免费个人排班档案。', expectedName: '个人排班', expectedNote: '' },
  { name: '主账号', note: '已绑定森空岛的免费个人排班档案。', expectedName: '主账号', expectedNote: '' },
  { name: '免费个人排班', note: '官服小号', expectedName: '个人排班', expectedNote: '官服小号' },
  { name: '免费个人排班－小号', note: '已绑定森空岛的免费个人排班档案。自用', expectedName: '免费个人排班－小号', expectedNote: '已绑定森空岛的免费个人排班档案。自用' },
  { name: '个人排班', note: '', expectedName: '个人排班', expectedNote: '' },
  { name: '免费个人排班', note: '已绑定森空岛的免费个人排班档案。', suppliedName: '新主账号', suppliedNote: '新备注', expectedName: '新主账号', expectedNote: '新备注' },
  { name: '主账号', note: '官服', suppliedNote: '', expectedName: '主账号', expectedNote: '' },
  { name: '主账号', note: '官服', suppliedName: '免费个人排班', suppliedNote: '已绑定森空岛的免费个人排班档案。', expectedName: '免费个人排班', expectedNote: '已绑定森空岛的免费个人排班档案。' },
])('preserves custom metadata and cleans legacy defaults on upgrade: $name / $note', async ({ name, note, suppliedName, suppliedNote, expectedName, expectedNote }) => {
  const target = await profile(name, note)
  const code = await cdk()
  const upgrade = () => upgradePreviewProfileWithCdk(user, target.id, code, suppliedName, suppliedNote, 'upgrade')
  const upgraded = await upgrade()
  const expected = { id: target.id, kind: 'cdk', display_name: expectedName, note: expectedNote }
  expect(upgraded).toMatchObject({ ok: true, profile: expected })
  expect(await getProfileById(target.id)).toMatchObject(expected)
  await saveUserProfile({ ...(await getProfileById(target.id))!, display_name: '升级后改名', note: '升级后备注' })
  expect(await upgrade()).toEqual(upgraded)
  expect(await getProfileById(target.id)).toMatchObject({ display_name: '升级后改名', note: '升级后备注' })
})

it('rejects reusing an upgrade key when an omitted note becomes an explicit clear', async () => {
  const target = await profile('主账号', '保留备注')
  const code = await cdk()
  expect(await upgradePreviewProfileWithCdk(user, target.id, code, undefined, undefined, 'same-key'))
    .toMatchObject({ ok: true, profile: { note: '保留备注' } })
  expect(await upgradePreviewProfileWithCdk(user, target.id, code, undefined, '', 'same-key'))
    .toMatchObject({ ok: false, status: 409 })
  expect(await getProfileById(target.id)).toMatchObject({ note: '保留备注' })
})

it('keeps legacy metadata when CDK redemption fails', async () => {
  const target = await profile('免费个人排班', '已绑定森空岛的免费个人排班档案。')
  const result = await upgradePreviewProfileWithCdk(user, target.id, await cdk('frozen'))
  expect(result.ok).toBe(false)
  expect(await getProfileById(target.id)).toEqual(target)
})

it('previews and atomically repairs existing CDK metadata without touching custom or free profiles', async () => {
  const legacy = await profile('免费个人排班', '已绑定森空岛的免费个人排班档案。', 'cdk')
  const customName = await profile('主账号', '已绑定森空岛的免费个人排班档案。', 'cdk')
  const customNote = await profile('免费个人排班', '官服', 'cdk')
  const custom = await profile('免费个人排班－小号', '备注', 'cdk')
  const free = await profile('免费个人排班', '已绑定森空岛的免费个人排班档案。')
  const script = 'scripts/repair-profile-default-metadata.mjs'
  const preview = JSON.parse((await run(process.execPath, [script])).stdout)
  expect(preview).toMatchObject({ mode: 'preview', count: 3 })
  expect(preview.changes).toContainEqual({ id: legacy.id, before: { display_name: legacy.display_name, note: legacy.note }, after: { display_name: '个人排班', note: '' } })
  expect(await getProfileById(legacy.id)).toEqual(legacy)
  const applied = JSON.parse((await run(process.execPath, [script, '--apply'])).stdout)
  expect(applied).toMatchObject({ mode: 'applied', count: 3 })
  expect(await getProfileById(legacy.id)).toMatchObject({ display_name: '个人排班', note: '' })
  expect(await getProfileById(customName.id)).toMatchObject({ display_name: '主账号', note: '' })
  expect(await getProfileById(customNote.id)).toMatchObject({ display_name: '个人排班', note: '官服' })
  expect(await getProfileById(custom.id)).toEqual(custom)
  expect(await getProfileById(free.id)).toEqual(free)
  const { rows } = await query('select display_name, note, record_json from user_game_accounts where id = $1', [legacy.id])
  expect(rows[0]).toMatchObject({ display_name: '个人排班', note: '', record_json: { display_name: '个人排班', note: '' } })
  expect(JSON.parse((await run(process.execPath, [script, '--apply'])).stdout)).toMatchObject({ count: 0, changes: [] })
})

it('rolls back all metadata repairs when a later update fails', async () => {
  const targets = [await profile('免费个人排班', '保留备注', 'cdk'), await profile('免费个人排班', '保留备注', 'cdk')]
    .sort((left, right) => left.id.localeCompare(right.id))
  targets[1] = { ...targets[1], note: '已绑定森空岛的免费个人排班档案。' }
  await saveUserProfile(targets[1])
  await query("alter table user_game_accounts add constraint metadata_repair_failure check (note <> '') not valid")
  try {
    await expect(run(process.execPath, ['scripts/repair-profile-default-metadata.mjs', '--apply'])).rejects.toMatchObject({ code: 1 })
    for (const target of targets) expect(await getProfileById(target.id)).toEqual(target)
  } finally {
    await query('alter table user_game_accounts drop constraint metadata_repair_failure')
  }
})

async function profile(displayName: string, note: string, kind: UserGameAccountRecord['kind'] = 'free_preview') {
  const now = new Date().toISOString()
  const value: UserGameAccountRecord = { version: 1, id: randomUUID(), user_id: user.id, kind, authorization_source: 'admin_grant',
    cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, permission: 'growth', status: 'active', display_name: displayName, note, created_at: now, updated_at: now }
  await saveUserProfile(value)
  return value
}

async function cdk(status: 'unused' | 'frozen' = 'unused') {
  const code = `METADATA-${randomUUID()}`
  const codeHash = hashCdk(code, process.env.CDK_HASH_SECRET!)
  await createPostgresCdkRecordStore().create(`cdk/${codeHash}.json`, {
    version: 2, cdk_type: 'profile', code_hash: codeHash, permission: 'advanced', balance_amount: null,
    status, created_at: new Date().toISOString(), used_at: null, order_note: null, license_order_hash: null, operator_count: null, config_desc: null,
  })
  return code
}
