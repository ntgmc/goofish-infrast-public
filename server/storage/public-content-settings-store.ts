import {
  cloneDefaultPublicContentSettings,
  normalizePublicContentSettings,
  parsePublicContentDraft,
  PUBLIC_CONTENT_VERSION,
  type PublicContentDraftV1,
  type PublicContentSettingsV1,
} from '../../src/lib/public-content'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

const PUBLIC_CONTENT_SETTINGS_KEY = 'global'
let schemaReady: Promise<void> | null = null

export async function getPublicContentSettings(): Promise<PublicContentSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: unknown }>(
    'select record_json from public_content_settings where key = $1',
    [PUBLIC_CONTENT_SETTINGS_KEY],
  )
  if (!result.rows[0]) return cloneDefaultPublicContentSettings()
  return normalizePublicContentSettings(result.rows[0].record_json)
}

export async function savePublicContentSettings(input: PublicContentDraftV1): Promise<PublicContentSettingsV1> {
  await ensureSchema()
  const draft = parsePublicContentDraft(input)
  const saved: PublicContentSettingsV1 = {
    version: PUBLIC_CONTENT_VERSION,
    ...draft,
    updated_at: new Date().toISOString(),
  }
  await query(
    `insert into public_content_settings (key, record_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set record_json = excluded.record_json, updated_at = now()`,
    [PUBLIC_CONTENT_SETTINGS_KEY, JSON.stringify(saved)],
  )
  return saved
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
