import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from './settings-conflict'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }))
vi.mock('./postgres', () => ({
  query: mocks.query,
  withTransaction: async (work: (client: { query: typeof mocks.clientQuery }) => unknown) => work({ query: mocks.clientQuery }),
}))

import { createPostgresRiskControlSettingsStore } from './risk-settings-store'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined)
})

describe('risk settings optimistic concurrency and audit', () => {
  it('increments revision with CAS and writes a chained immutable audit record', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from risk_settings where key = $1 for update')) {
        return { rows: [{ record_json: { operator_data_risk_enabled: true, revision: 2, updated_at: '2026-08-01T00:00:00.000Z' }, revision: 2 }] }
      }
      if (sql.includes('insert into risk_settings (key')) return { rows: [], rowCount: 1 }
      if (sql.includes('select entry_hash from risk_settings_audit')) return { rows: [{ entry_hash: 'f'.repeat(64) }] }
      return { rows: [], rowCount: 1 }
    })

    const result = await createPostgresRiskControlSettingsStore().set({
      patch: { operator_data_risk_enabled: false },
      expectedRevision: 2,
      adminUsername: 'security-admin',
      reason: '临时关闭异常检测以排查误报',
      requestId: 'request-123',
    })

    expect(result).toMatchObject({ operator_data_risk_enabled: false, revision: 3 })
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('where risk_settings.revision = $5'),
      expect.arrayContaining([3, 2]),
    )
    const auditCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('insert into risk_settings_audit'))
    expect(auditCall?.[1]).toEqual(expect.arrayContaining([
      'security-admin',
      'global',
      '临时关闭异常检测以排查误报',
      'request-123',
      'f'.repeat(64),
    ]))
    expect(auditCall?.[1]?.[8]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a stale revision before writing settings or audit rows', async () => {
    mocks.clientQuery.mockResolvedValueOnce({
      rows: [{ record_json: { operator_data_risk_enabled: true, revision: 3 }, revision: 3 }],
    })

    await expect(createPostgresRiskControlSettingsStore().set({
      patch: { operator_data_risk_enabled: false },
      expectedRevision: 2,
      adminUsername: 'security-admin',
      reason: '关闭开关',
      requestId: 'request-456',
    })).rejects.toBeInstanceOf(SettingsConflictError)

    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('insert into risk_settings ('), expect.anything())
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('insert into risk_settings_audit'), expect.anything())
  })
})
