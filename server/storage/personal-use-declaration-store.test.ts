import { describe, expect, it, vi } from 'vitest'
import { markPersonalUseDeclarationAcceptancesDeleted } from './personal-use-declaration-store'

describe('personal use declaration retention', () => {
  it('marks records for one additional year when the account is deleted', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    const deletedAt = new Date('2026-07-23T10:00:00.000Z')

    await markPersonalUseDeclarationAcceptancesDeleted(client, 'user-1', deletedAt)

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('set account_deleted_at'),
      ['user-1', '2026-07-23T10:00:00.000Z', '2027-07-23T10:00:00.000Z'],
    )
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('personal_use_declaration_usage_events'),
      ['user-1', '2026-07-23T10:00:00.000Z', '2027-07-23T10:00:00.000Z'],
    )
  })
})
