import {
  cloneDefaultPublicContentSettings,
  normalizePublicContentSettings,
  parsePublicContentDraft,
  PUBLIC_CONTENT_DEFAULTS_REVISION,
  PUBLIC_CONTENT_VERSION,
  type AdminPublicContentSettingsV1,
  type PublicContentDraftV1,
  type PublicContentSettingsV1,
} from '../../src/lib/public-content'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { SettingsConflictError } from './settings-conflict'

const PUBLIC_CONTENT_SETTINGS_KEY = 'global'
let schemaReady: Promise<void> | null = null

export async function getPublicContentSettings(): Promise<AdminPublicContentSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: unknown; revision: number }>(
    'select record_json, revision from public_content_settings where key = $1',
    [PUBLIC_CONTENT_SETTINGS_KEY],
  )
  const row = result.rows[0]
  if (!row) return { ...cloneDefaultPublicContentSettings(), revision: 0 }
  return { ...normalizePublicContentSettings(row.record_json), revision: row.revision }
}

export async function savePublicContentSettings(input: PublicContentDraftV1, expectedRevision: number): Promise<AdminPublicContentSettingsV1> {
  await ensureSchema()
  const draft = parsePublicContentDraft(input)
  const saved: PublicContentSettingsV1 = {
    version: PUBLIC_CONTENT_VERSION,
    defaults_revision: PUBLIC_CONTENT_DEFAULTS_REVISION,
    ...draft,
    updated_at: new Date().toISOString(),
  }
  const result = await query<{ revision: number }>(
    `with updated as (
       update public_content_settings
       set record_json = $2::jsonb, updated_at = $3::timestamptz, revision = revision + 1
       where key = $1 and revision = $4
       returning revision
     ), inserted as (
       insert into public_content_settings (key, record_json, updated_at, revision)
       select $1, $2::jsonb, $3::timestamptz, 1
       where $4 = 0 and not exists (select 1 from public_content_settings where key = $1)
       on conflict (key) do nothing
       returning revision
     )
     select revision from updated
     union all
     select revision from inserted`,
    [PUBLIC_CONTENT_SETTINGS_KEY, JSON.stringify(saved), saved.updated_at, expectedRevision],
  )
  const revision = result.rows[0]?.revision
  if (revision === undefined) throw new SettingsConflictError()
  return { ...saved, revision }
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
