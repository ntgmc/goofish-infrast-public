import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { aiConfigurationIssues, aiSettingsSchema, DEFAULT_AI_SETTINGS, getAiRequestReservation, type AdminAiSettings, type AiSettings, type AiSettingsUpdate } from '../../src/lib/ai-settings'
import { computeEffectiveSiteFeatures, normalizeSiteFeatureSettings } from '../../src/lib/site-features'
import { getSecretKeyring } from '../handlers/license-utils'
import { recordAdminOperationAuditInTransaction } from './admin-operation-audit-store'
import { getSiteFeatureSettings } from './feature-settings-store'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { SettingsConflictError } from './settings-conflict'

interface StoredAiSettings { settings: AiSettings; encrypted_api_key: string | null; revision: number; updated_at: Date | null }
export class AiSettingsValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) { super('AI 设置无效。') }
}

export async function getAdminAiSettings(): Promise<AdminAiSettings> {
  const [stored, features] = await Promise.all([readStoredSettings(), getSiteFeatureSettings()])
  return { settings: stored.settings, has_api_key: Boolean(stored.encrypted_api_key), revision: stored.revision,
    updated_at: stored.updated_at?.toISOString() ?? null, enabled: features.features.ai_schedule_explanation,
    effective_enabled: computeEffectiveSiteFeatures(features).ai_schedule_explanation, feature_revision: features.revision }
}

export async function getScheduleExplanationConfig() {
  const [stored, features] = await Promise.all([readStoredSettings(), getSiteFeatureSettings()])
  const enabled = computeEffectiveSiteFeatures(features).ai_schedule_explanation && aiConfigurationIssues(stored.settings, Boolean(stored.encrypted_api_key)).length === 0
  return { ...stored.settings, enabled, apiKey: enabled ? decryptKey(stored.encrypted_api_key!) : '',
    reservation: getAiRequestReservation(stored.settings),
    dailyBudget: Math.floor(stored.settings.dailyBudget * 1e6), monthlyBudget: Math.floor(stored.settings.monthlyBudget * 1e6) }
}
export type ScheduleExplanationConfig = Awaited<ReturnType<typeof getScheduleExplanationConfig>>

export async function saveAdminAiSettings(update: AiSettingsUpdate, actorUsername: string, requestId: string): Promise<void> {
  await ensureDatabaseSchema()
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('ai-settings'))")
    const existing = await client.query<StoredAiSettings>('select settings, encrypted_api_key, revision, updated_at from ai_settings where key = $1 for update', ['global'])
    const previous = existing.rows[0]
    if ((previous?.revision ?? 0) !== update.expected_revision) throw new SettingsConflictError()
    const featureRows = await client.query<{ record_json: unknown; revision: number }>('select record_json, revision from feature_settings where key = $1 for update', ['global'])
    const featureRow = featureRows.rows[0]
    if ((featureRow?.revision ?? 0) !== update.expected_feature_revision) throw new SettingsConflictError()
    const features = normalizeSiteFeatureSettings(featureRow?.record_json)
    const encryptedKey = update.clear_api_key ? null : update.api_key ? encryptKey(update.api_key) : previous?.encrypted_api_key ?? null
    if (update.enabled) {
      const issues = aiConfigurationIssues(update.settings, Boolean(encryptedKey))
      if (issues.length) throw new AiSettingsValidationError(issues)
    }
    const updatedAt = new Date().toISOString()
    await client.query(`insert into ai_settings (key, settings, encrypted_api_key, revision, updated_at) values ('global', $1::jsonb, $2, $3, $4)
      on conflict (key) do update set settings = excluded.settings, encrypted_api_key = excluded.encrypted_api_key, revision = excluded.revision, updated_at = excluded.updated_at`,
    [JSON.stringify(update.settings), encryptedKey, update.expected_revision + 1, updatedAt])
    const before = { settings: previous?.settings ?? DEFAULT_AI_SETTINGS, enabled: features.features.ai_schedule_explanation, has_api_key: Boolean(previous?.encrypted_api_key) }
    features.features.ai_schedule_explanation = update.enabled
    features.updated_at = updatedAt
    const savedFeatures = await client.query(`insert into feature_settings (key, record_json, revision, updated_at) values ('global', $1::jsonb, $2, $3)
      on conflict (key) do update set record_json = excluded.record_json, revision = excluded.revision, updated_at = excluded.updated_at
        where feature_settings.revision = $2 - 1 returning revision`, [JSON.stringify(features), update.expected_feature_revision + 1, updatedAt])
    if (!savedFeatures.rows.length) throw new SettingsConflictError()
    await recordAdminOperationAuditInTransaction(client, { actorUsername, action: 'ai.settings.update', targetType: 'ai_settings', targetId: 'global',
      reason: update.reason, requestId, before, after: { settings: update.settings, enabled: update.enabled, has_api_key: Boolean(encryptedKey),
        api_key_action: update.clear_api_key ? 'cleared' : update.api_key ? 'replaced' : 'unchanged' } })
  })
}

async function readStoredSettings(): Promise<StoredAiSettings> {
  await ensureDatabaseSchema()
  const result = await query<StoredAiSettings>('select settings, encrypted_api_key, revision, updated_at from ai_settings where key = $1', ['global'])
  const row = result.rows[0]
  return row ? { ...row, settings: aiSettingsSchema.parse(row.settings) }
    : { settings: { ...DEFAULT_AI_SETTINGS }, encrypted_api_key: null, revision: 0, updated_at: null }
}

function encryptionKey(secret: string) { return createHash('sha256').update(`ai-settings-v1:${secret}`).digest() }
function encryptKey(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(getSecretKeyring('MAA_ADMIN_SECRET')[0]), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}
function decryptKey(value: string): string {
  const bytes = Buffer.from(value, 'base64')
  for (const secret of getSecretKeyring('MAA_ADMIN_SECRET')) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    } catch { /* Try the previous key during the existing secret rotation window. */ }
  }
  throw new Error('AI API 密钥无法解密，请在管理后台重新配置。')
}
