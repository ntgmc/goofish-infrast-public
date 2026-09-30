import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INVITATION_SETTINGS, getAdminInvitationSettingsOverview } from './invitation-store'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'

let container: Awaited<ReturnType<PostgreSqlContainer['start']>>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('delete from invitations')
  await query('delete from user_accounts')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T03:00:00.000Z'))
})

afterEach(() => vi.useRealTimers())

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('administrator invitation statistics', () => {
  it('returns zero counts when there are no invitations', async () => {
    expect((await getAdminInvitationSettingsOverview()).stats).toEqual({
      as_of: '2026-09-30T03:00:00.000Z',
      registered: 0,
      activated: 0,
      rewarded_invitations: 0,
      pending_rewards: 0,
      retrying_rewards: 0,
      failed_rewards: 0,
      today_registered: 0,
      today_activated: 0,
      today_rewarded: 0,
    })
  })

  it('counts reward recipients once, separates failures and uses Shanghai day boundaries', async () => {
    await query(
      `insert into user_accounts
         (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
       select 'user-' || id, 'user-' || id || '@example.test', '', '', 1, 'user', 'active',
              '{}'::jsonb, $1::timestamptz, $1::timestamptz
         from generate_series(1, 9) as id`,
      ['2026-09-29T15:59:59.999Z'],
    )
    await query(
      `insert into invitations
         (id, invitee_user_id, invitation_code, status, registered_at, activated_at,
          settled_at, inviter_rewarded_at, settlement_json, settings_snapshot,
          processing_started_at, dead_lettered_at, updated_at)
       select 'invitation-' || id, 'user-' || id, 'TESTCODE01', status,
              registered_at::timestamptz, activated_at::timestamptz,
              settled_at::timestamptz, inviter_rewarded_at::timestamptz,
              settlement_json::jsonb, $3::jsonb,
              case when status = 'processing' then $1::timestamptz end,
              case when status = 'dead_letter' then $1::timestamptz end, $1::timestamptz
         from (values
           (1, 'registered', $2, null, null, null, null),
           (2, 'activated', $2, $1, null, null, null),
           (3, 'processing', $1, $1, null, null, null),
           (4, 'failed', $1, $1, null, null, null),
           (5, 'dead_letter', $2, $2, null, null, null),
           (6, 'settled', $2, $2, $1, $1, '{"rewards":{"inviter":{"status":"granted"}}}'),
           (7, 'settled', $1, $1, $1, null, '{"rewards":{"invitee":{"status":"granted"}}}'),
           (8, 'settled', $2, $2, $2, $2, '{"rewards":{"inviter":{"status":"granted"},"invitee":{"status":"granted"}}}'),
           (9, 'settled', $2, $2, $1, null, '{"rewards":{"inviter":{"status":"daily_limit_skipped"},"invitee":{"status":"not_configured"}}}')
         ) as records(id, status, registered_at, activated_at, settled_at, inviter_rewarded_at, settlement_json)`,
      ['2026-09-29T16:00:00.000Z', '2026-09-29T15:59:59.999Z', JSON.stringify(DEFAULT_INVITATION_SETTINGS)],
    )

    expect((await getAdminInvitationSettingsOverview()).stats).toEqual({
      as_of: '2026-09-30T03:00:00.000Z',
      registered: 9,
      activated: 8,
      rewarded_invitations: 3,
      pending_rewards: 2,
      retrying_rewards: 1,
      failed_rewards: 1,
      today_registered: 3,
      today_activated: 4,
      today_rewarded: 2,
    })
  })
})
