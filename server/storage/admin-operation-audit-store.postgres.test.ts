import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { getAdminOperationAudit, listAdminOperationAudits, recordAdminOperationAudit } from './admin-operation-audit-store'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

it('merges all legacy stores, scopes combined filters, keeps timestamp order and omits snapshots from lists', async () => {
  await recordAdminOperationAudit({ actorUsername: 'operator', action: 'user.freeze_account', targetType: 'user', targetId: 'target-1', reason: '工单处理', requestId: 'request-1', before: { status: 'active' }, after: { status: 'frozen' }, createdAt: '2026-11-08T00:00:00Z' })
  await query(`insert into inventory_admin_audit (id, admin_username, action, target_type, target_id, reason, before_json, after_json, created_at)
    values ('same-id', 'operator', 'grant_item', 'user', 'target-1', '补发道具', '{"quantity":1}', '{"quantity":2}', '2026-11-08T00:00:00.100Z'),
      ('unrelated', 'other', 'grant_item', 'profile', 'target-1', '另一对象', null, null, '2026-11-08T00:00:00.100Z')`)
  await query(`insert into behavior_risk_review_audit (id, case_id, admin_username, outcome, note, actions_json, case_snapshot_json, created_at, expires_at)
    values ('same-id', null, 'reviewer', 'restrict', '复核处理', '[{"user_id":"target-1","action":"freeze_account"}]', '{"id":"archived-case"}', '2026-11-08T00:00:01Z', '2030-01-01')`)
  await query(`insert into behavior_risk_admin_audit (id, admin_username, capability, action, decision, reason, request_id, created_at)
    values ('access-1', 'operator', 'risk_view', 'GET /api/admin/behavior-risk', 'allow', '权限校验通过', 'request-1', '2026-11-08T00:00:02Z')`)
  const all = await listAdminOperationAudits(1, 25, {})
  expect(all.pagination.total).toBe(5)
  expect(all.items.map((item) => item.source)).toEqual(['risk_access', 'risk_review', 'inventory', 'inventory', 'admin'])
  expect(all.items.at(-1)).not.toHaveProperty('before_json')
  const filtered = await listAdminOperationAudits(1, 25, { actor: 'operator', action: 'grant_item', target_type: 'user', target_id: 'target-1', from: '2026-11-08T00:00:00.100Z', to: '2026-11-08T00:00:00.100Z' })
  expect(filtered.items.map((item) => item.id)).toEqual(['same-id'])
  expect((await listAdminOperationAudits(1, 25, { actor: "operator' OR true --" })).items).toEqual([])
  expect((await listAdminOperationAudits(1, 25, { request_id: 'request-1' })).items).toHaveLength(2)
  expect(await getAdminOperationAudit('inventory', 'same-id')).toMatchObject({ before_json: { quantity: 1 }, after_json: { quantity: 2 }, request_id: null })
  expect(await getAdminOperationAudit('risk_review', 'same-id')).toMatchObject({ target_type: 'risk_case', target_id: 'archived-case', before_json: null, after_json: null, context_json: { case_snapshot: { id: 'archived-case' }, actions: [{ user_id: 'target-1', action: 'freeze_account' }] } })
  expect(await getAdminOperationAudit('admin', 'same-id')).toBeNull()
  const origin = all.items.find((item) => item.source === 'admin')!
  const related = await listAdminOperationAudits(1, 25, { related_source: origin.source, related_id: origin.id })
  expect(related.items.map((item) => item.id)).toEqual(['access-1', 'same-id'])
  expect((await listAdminOperationAudits(1, 25, { related_source: 'inventory', related_id: 'same-id' })).items.map((item) => item.source)).toEqual(['admin'])
  expect((await listAdminOperationAudits(1, 25, { related_source: 'admin', related_id: 'missing' })).items).toEqual([])
})

it('includes settings, registration, commercial and administrator balance changes without user billing events', async () => {
  await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ('audit-account', 'audit@example.test', 'hash', 'salt', 1, 'recommended', 'active', '{}', now(), now())`)
  await query(`insert into risk_settings_audit (id, admin_username, settings_key, reason, request_id, before_json, after_json, entry_hash, created_at)
    values ('settings-1', 'config-admin', 'global', '调整风险配置', 'settings-request', '{"enabled":true}', '{"enabled":false}', 'test-hash', now())`)
  await query(`insert into admin_registration_invitation_audit (id, invitation_id, admin_username, action, reason, request_hash, before_json, after_json, created_at)
    values ('registration-1', 'invitation-1', 'config-admin', 'revoke', '撤销误发邀请', 'test-hash', '{"status":"active"}', '{"status":"revoked"}', now())`)
  await query(`insert into commercial_account_audit (id, user_id, actor_username, approved_by, request_id, request_hash, reason, before_json, after_json, created_at)
    values ('commercial-1', 'audit-account', 'config-admin', 'root', 'commercial-request', 'test-hash', '调整商用限额', '{"total":2}', '{"total":3}', now())`)
  await query(`insert into user_balance_transactions (id, user_id, kind, amount, balance_after, reference_type, reference_id, admin_username, approved_by, reason, created_at)
    values ('balance-1', 'audit-account', 'admin_debit', -1.25, 8.75, 'admin', 'balance-ref-1', 'config-admin', 'root', '纠正积分误发', now()),
      ('balance-2', 'audit-account', 'schedule_debit', -2, 6.75, 'schedule', 'job-ref-1', null, null, null, now())`)
  const records = await listAdminOperationAudits(1, 25, { actor: 'config-admin' })
  expect(new Set(records.items.map((item) => item.source))).toEqual(new Set(['risk_settings', 'registration', 'commercial', 'balance']))
  expect(await getAdminOperationAudit('balance', 'balance-1')).toMatchObject({ action: 'balance.admin_debit', target_type: 'user', target_id: 'audit-account', before_json: { balance: '10.00' }, after_json: { balance: '8.75' }, context_json: { approved_by: 'root', amount: '-1.25', reference_id: 'balance-ref-1' } })
  expect(await getAdminOperationAudit('balance', 'balance-2')).toBeNull()
  expect(await getAdminOperationAudit('risk_settings', 'settings-1')).toMatchObject({ before_json: { enabled: true }, after_json: { enabled: false }, context_json: { integrity_hash: 'test-hash' } })
  const related = await listAdminOperationAudits(1, 25, { related_source: 'commercial', related_id: 'commercial-1' })
  expect(related.items.map((item) => item.id)).toEqual(['balance-1'])
})

it('paginates merged records consistently and clamps a page after narrowing the query', async () => {
  await query(`insert into inventory_admin_audit (id, admin_username, action, target_type, target_id, reason, created_at)
    select 'page-' || n, 'pager', 'grant_item', 'user', 'page-target', '分页验证', '2026-11-08T01:00:00Z'::timestamptz + n * interval '1 millisecond' from generate_series(1, 30) n`)
  const first = await listAdminOperationAudits(1, 25, { actor: 'pager' })
  const second = await listAdminOperationAudits(2, 25, { actor: 'pager' })
  expect(first.pagination).toEqual({ page: 1, page_size: 25, total: 30, total_pages: 2 })
  expect(first.items[0]!.id).toBe('page-30')
  expect(second.items.map((item) => item.id)).toEqual(['page-5', 'page-4', 'page-3', 'page-2', 'page-1'])
  expect(new Set([...first.items, ...second.items].map((item) => `${item.source}:${item.id}`)).size).toBe(30)
  expect((await listAdminOperationAudits(2, 25, { actor: 'operator', target_type: 'user' })).pagination.page).toBe(1)
})
