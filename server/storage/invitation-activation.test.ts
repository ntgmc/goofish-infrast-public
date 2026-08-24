import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn(async () => undefined),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('./postgres', async (importOriginal) => ({
  ...await importOriginal<typeof import('./postgres')>(),
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}))

vi.mock('./schema', async (importOriginal) => ({
  ...await importOriginal<typeof import('./schema')>(),
  ensureDatabaseSchema: mocks.ensureDatabaseSchema,
}))

import { activateInvitationForUser } from './invitation-store'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('invitation activation', () => {
  it('waits until the invitee has an active profile bound to Skland', async () => {
    const unboundClient = invitationClient(false)
    mocks.withTransaction.mockImplementationOnce(async (run) => run(unboundClient))

    await expect(activateInvitationForUser('invitee-1')).resolves.toBe(false)
    expect(unboundClient.query).not.toHaveBeenCalledWith(expect.stringContaining('update invitations'), expect.anything())

    const boundClient = invitationClient(true)
    mocks.withTransaction.mockImplementationOnce(async (run) => run(boundClient))

    await expect(activateInvitationForUser('invitee-1')).resolves.toBe(true)
    expect(boundClient.query).toHaveBeenCalledWith(expect.stringContaining('update invitations'), expect.any(Array))
  })
})

function invitationClient(bound: boolean) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('from invitations where invitee_user_id')) {
        return { rows: [{
          id: 'invitation-1',
          inviter_user_id: 'inviter-1',
          invitee_user_id: 'invitee-1',
          status: 'registered',
          activated_at: null,
          settings_snapshot: null,
          attempt_count: 0,
          next_retry_at: null,
          processing_started_at: null,
          last_error: null,
          dead_lettered_at: null,
        }] }
      }
      if (sql.includes('select exists (select 1 from user_game_accounts')) {
        expect(sql).toContain("record_json->'skland_binding' is not null")
        return { rows: [{ active: bound }] }
      }
      if (sql.includes('from invitation_settings')) return { rows: [] }
      if (sql.includes('update invitations')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected query: ${sql}`)
    }),
  }
}
