import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import { createApiServer } from '../http-server'
import { flushPerformanceDurations } from '../performance-observation'
import { getSiteFeatureSettings, saveSiteFeatureSettings } from './feature-settings-store'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { SettingsConflictError } from './settings-conflict'

let container: StartedPostgreSqlContainer | undefined
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  await ensureDatabaseSchema()
})
beforeEach(async () => {
  await query('delete from feature_settings')
})
afterAll(async () => {
  await closePool()
  await container?.stop()
  vi.unstubAllEnvs()
})

describe('Drizzle feature settings storage', () => {
  it('reads defaults before the first save and preserves the stored JSON and timestamp', async () => {
    expect(await getSiteFeatureSettings()).toEqual({ ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 0 })
    const features = { ...DEFAULT_SITE_FEATURE_SETTINGS.features, v1: false }
    const saved = await saveSiteFeatureSettings(features, 0)
    expect(saved).toMatchObject({ version: 1, features, revision: 1 })
    expect(await getSiteFeatureSettings()).toEqual(saved)
    const stored = await query<{ record_json: unknown; updated_at: Date }>(
      "select record_json, updated_at from feature_settings where key = 'global'",
    )
    const { revision: _revision, ...document } = saved
    expect(stored.rows[0]?.record_json).toEqual(document)
    expect(stored.rows[0]?.updated_at.toISOString()).toBe(saved.updated_at)
  })

  it('retains the stored billing setting while keeping the effective feature retired', async () => {
    const saved = await saveSiteFeatureSettings({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, metered_billing: true }, 0)
    const stored = await getSiteFeatureSettings()
    expect(stored).toEqual(saved)
    expect(stored.features.metered_billing).toBe(true)
    expect(computeEffectiveSiteFeatures(stored).metered_billing).toBe(false)
    expect(computeEffectiveSiteFeatures(stored).schedule_generation).toBe(true)
  })

  it('rejects an update to a missing revision without inserting a row', async () => {
    await expect(saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 1)).rejects.toBeInstanceOf(
      SettingsConflictError,
    )
    expect((await getSiteFeatureSettings()).revision).toBe(0)
  })

  it('allows only one concurrent first save', async () => {
    const results = await Promise.allSettled([
      saveSiteFeatureSettings({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, v1: false }, 0),
      saveSiteFeatureSettings({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, announcements: false }, 0),
    ])
    const success = results.filter((result) => result.status === 'fulfilled')
    const failure = results.filter((result) => result.status === 'rejected')
    expect(success).toHaveLength(1)
    expect(failure).toHaveLength(1)
    expect(failure[0]?.reason).toBeInstanceOf(SettingsConflictError)
    expect(await getSiteFeatureSettings()).toEqual(success[0]?.value)
  })

  it('allows one writer per revision and rejects stale writes without changing settings', async () => {
    const original = await saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 0)
    const results = await Promise.allSettled([
      saveSiteFeatureSettings({ ...original.features, v1: false }, original.revision),
      saveSiteFeatureSettings({ ...original.features, announcements: false }, original.revision),
    ])
    const success = results.filter((result) => result.status === 'fulfilled')
    const failure = results.filter((result) => result.status === 'rejected')
    expect(success).toHaveLength(1)
    expect(failure).toHaveLength(1)
    expect(failure[0]?.reason).toBeInstanceOf(SettingsConflictError)
    expect(success[0]?.value.revision).toBe(2)
    await expect(saveSiteFeatureSettings(original.features, original.revision)).rejects.toBeInstanceOf(
      SettingsConflictError,
    )
    expect(await getSiteFeatureSettings()).toEqual(success[0]?.value)
  })

  it('serves persisted settings through Fastify and the real HTTP boundary', async () => {
    const saved = await saveSiteFeatureSettings({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, v1: false }, 0)
    const server = createApiServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected an HTTP listener')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/site/features`)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Request-ID')).toBeTruthy()
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({
        version: saved.version,
        features: computeEffectiveSiteFeatures(saved),
        updated_at: saved.updated_at,
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('keeps Drizzle queries in the existing PostgreSQL performance observations', async () => {
    const events: Array<Record<string, unknown>> = []
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    try {
      await getSiteFeatureSettings()
      flushPerformanceDurations()
      events.length = 0
      await saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 0)
      await getSiteFeatureSettings()
      flushPerformanceDurations()
      for (const operation of ['INSERT', 'SELECT']) {
        expect(events).toContainEqual(
          expect.objectContaining({
            event: 'performance.duration',
            metric: 'postgres.query',
            labels: { operation, outcome: 'success' },
            count: 1,
          }),
        )
      }
    } finally {
      consoleInfo.mockRestore()
    }
  })
})
