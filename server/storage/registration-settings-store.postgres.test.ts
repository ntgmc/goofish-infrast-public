import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { DEFAULT_REGISTRATION_SETTINGS, getRegistrationSettings, saveRegistrationSettings } from './registration-settings-store'
import { SettingsConflictError } from './settings-conflict'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})
beforeEach(async () => { await query('delete from registration_settings') })
afterAll(async () => { await closePool(); await container.stop() })

const { version: _version, updated_at: _updatedAt, ...patch } = DEFAULT_REGISTRATION_SETTINGS

describe('registration settings concurrency', () => {
  it('allows only one concurrent first save when no settings row exists', async () => {
    const results = await Promise.allSettled([
      saveRegistrationSettings({ ...patch, invite_code_required: true }, null),
      saveRegistrationSettings({ ...patch, admin_invite_email_reserve: 20 }, null),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const failure = results.find((result) => result.status === 'rejected')
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(SettingsConflictError)
  })

  it('rejects a stale mail edit without undoing registration restrictions and advances each version', async () => {
    const old = await getRegistrationSettings()
    const first = await saveRegistrationSettings({ ...patch, invite_code_required: true }, old.updated_at)
    await expect(saveRegistrationSettings({ ...patch, admin_invite_email_reserve: 20 }, old.updated_at)).rejects.toBeInstanceOf(SettingsConflictError)
    expect(await getRegistrationSettings()).toEqual(first)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.updated_at!))
    try {
      const next = await saveRegistrationSettings({ ...patch, invite_code_required: true, admin_invite_email_reserve: 20 }, first.updated_at)
      expect(Date.parse(next.updated_at!)).toBeGreaterThan(Date.parse(first.updated_at!))
      await expect(saveRegistrationSettings(patch, first.updated_at)).rejects.toBeInstanceOf(SettingsConflictError)
      expect((await getRegistrationSettings()).invite_code_required).toBe(true)
    } finally { clock.mockRestore() }
  })
})
