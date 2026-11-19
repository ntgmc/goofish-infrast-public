import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS, type AiSettingsUpdate } from '../../src/lib/ai-settings'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { AiSettingsValidationError, getAdminAiSettings, getScheduleExplanationConfig, saveAdminAiSettings } from './ai-settings-store'
import { saveSiteFeatureSettings } from './feature-settings-store'
import { SettingsConflictError } from './settings-conflict'
let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  vi.stubEnv('MAA_ADMIN_SECRET', 'ai-settings-test-encryption-secret-at-least-32')
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop(); vi.unstubAllEnvs() })
const settings = { ...DEFAULT_AI_SETTINGS, provider: '测试服务商', baseURL: 'https://example.test/v1', model: 'chat', inputPrice: 1, outputPrice: 2 }
async function update(patch: Partial<AiSettingsUpdate> = {}) {
  const current = await getAdminAiSettings()
  await saveAdminAiSettings({ settings, enabled: true, clear_api_key: false, expected_revision: current.revision,
    expected_feature_revision: current.feature_revision, reason: '测试修改', ...patch }, 'test-admin', 'test-request')
}
it('defaults closed and validates enablement without committing partial settings', async () => {
  expect(await getAdminAiSettings()).toMatchObject({ enabled: false, has_api_key: false, revision: 0 })
  await expect(update()).rejects.toBeInstanceOf(AiSettingsValidationError)
  expect((await getAdminAiSettings()).revision).toBe(0)
  expect((await getScheduleExplanationConfig()).enabled).toBe(false)
})
it('encrypts the API key, projects only presence, audits changes and makes saved configuration live', async () => {
  await update({ api_key: 'private-api-token' })
  const admin = await getAdminAiSettings()
  expect(admin).toMatchObject({ has_api_key: true, enabled: true, effective_enabled: true, revision: 1, feature_revision: 1 })
  expect(JSON.stringify(admin)).not.toContain('private-api-token')
  const raw = await query('select * from ai_settings')
  expect(JSON.stringify(raw.rows)).not.toContain('private-api-token')
  expect(raw.rows[0].encrypted_api_key).toBeTruthy()
  expect(await getScheduleExplanationConfig()).toMatchObject({ apiKey: 'private-api-token', enabled: true, reservation: 9600 })
  const audit = await query('select before_json, after_json from admin_operation_audit where action = $1', ['ai.settings.update'])
  expect(audit.rows).toHaveLength(1)
  expect(JSON.stringify(audit.rows)).not.toContain('private-api-token')
  expect(audit.rows[0].after_json).toMatchObject({ api_key_action: 'replaced', has_api_key: true })
})
it('serializes edits and rolls back credential and feature changes on conflicts', async () => {
  const current = await getAdminAiSettings()
  const patch = { settings, enabled: true, clear_api_key: false, expected_revision: current.revision,
    expected_feature_revision: current.feature_revision, reason: '并发测试' }
  const results = await Promise.allSettled(['first-token', 'second-token'].map((api_key) => saveAdminAiSettings({ ...patch, api_key }, 'test-admin', 'parallel')))
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason).toBeInstanceOf(SettingsConflictError)
  const next = await getAdminAiSettings()
  await expect(saveAdminAiSettings({ ...patch, expected_revision: next.revision, api_key: 'must-not-save' }, 'test-admin', 'stale-feature')).rejects.toBeInstanceOf(SettingsConflictError)
  expect((await getScheduleExplanationConfig()).apiKey).not.toBe('must-not-save')
  expect((await getAdminAiSettings()).revision).toBe(next.revision)
})
it('preserves an omitted key, accepts rotation, follows feature switches and clears only explicitly', async () => {
  await update({ api_key: 'rotated-token', settings: { ...settings, protocol: 'openai_responses', monthlyLimit: 25 } })
  await update({ settings: { ...settings, protocol: 'anthropic_messages', trialLimit: 5 } })
  expect(await getScheduleExplanationConfig()).toMatchObject({ apiKey: 'rotated-token', protocol: 'anthropic_messages', trialLimit: 5 })
  vi.stubEnv('MAA_ADMIN_SECRET_PREVIOUS', process.env.MAA_ADMIN_SECRET!)
  vi.stubEnv('MAA_ADMIN_SECRET', 'replacement-admin-secret-at-least-32-characters')
  expect((await getScheduleExplanationConfig()).apiKey).toBe('rotated-token')
  const current = await getAdminAiSettings()
  const { DEFAULT_SITE_FEATURES } = await import('../../src/lib/site-features')
  const assistantOnly = { ...DEFAULT_SITE_FEATURES, ai_cultivation_advisor: true, schedule_explanation_avatar: false }
  await saveSiteFeatureSettings(assistantOnly, current.feature_revision)
  expect(await getAdminAiSettings()).toMatchObject({ enabled: false })
  expect(await getScheduleExplanationConfig()).toMatchObject({ enabled: false, apiKey: '' })
  expect(await getScheduleExplanationConfig('ai_cultivation_advisor')).toMatchObject({ enabled: true, apiKey: 'rotated-token' })
  expect(await getScheduleExplanationConfig('ai_goal_comparison')).toMatchObject({ enabled: false, apiKey: '' })
  await update({ enabled: false })
  expect((await getScheduleExplanationConfig('ai_cultivation_advisor')).enabled).toBe(true)
  await expect(update({ clear_api_key: true, enabled: false })).rejects.toBeInstanceOf(AiSettingsValidationError)
  await saveSiteFeatureSettings(DEFAULT_SITE_FEATURES, (await getAdminAiSettings()).feature_revision)
  await update({ clear_api_key: true, enabled: false })
  expect(await getAdminAiSettings()).toMatchObject({ enabled: false, has_api_key: false })
  expect((await query('select encrypted_api_key from ai_settings')).rows[0].encrypted_api_key).toBeNull()
})
