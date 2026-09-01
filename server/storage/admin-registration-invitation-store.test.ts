import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'

const postgresMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}))
const ensureDatabaseSchema = vi.hoisted(() => vi.fn())

vi.mock('./postgres', () => postgresMocks)
vi.mock('./schema', () => ({ ensureDatabaseSchema }))

import { saveRegistrationWithAdminInvitation } from './admin-registration-invitation-store'

describe('administrator registration invitation store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureDatabaseSchema.mockResolvedValue(undefined)
  })

  it('uses the caller clock when consuming an invitation in the registration transaction', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
    } as unknown as PoolClient
    postgresMocks.withTransaction.mockImplementation(async (work: (transactionClient: PoolClient) => Promise<void>) => {
      await work(client)
    })
    const saveUser = vi.fn().mockResolvedValue(undefined)
    const now = new Date('2026-07-21T04:00:00.000Z')

    await saveRegistrationWithAdminInvitation(
      saveUser,
      { id: 'invitation-id', codeHash: 'code-hash' },
      'user-id',
      now,
    )

    expect(saveUser).toHaveBeenCalledWith(client)
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('update admin_registration_invitations'),
      ['invitation-id', 'user-id', now.toISOString(), 'code-hash'],
    )
  })
})
