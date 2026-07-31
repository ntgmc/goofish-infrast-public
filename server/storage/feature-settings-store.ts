import type { AdminSiteFeatureSettingsV1, SiteFeatureSettingsV1, SiteFeatures } from '../../src/lib/site-features'
import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  SITE_FEATURE_KEYS,
  normalizeSiteFeatureSettings,
} from '../../src/lib/site-features'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { SettingsConflictError } from './settings-conflict'

const FEATURE_SETTINGS_KEY = 'global'
let schemaReady: Promise<void> | null = null

export { DEFAULT_SITE_FEATURE_SETTINGS, normalizeSiteFeatureSettings }

export function validateSiteFeatures(value: unknown): SiteFeatures {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('功能开关必须是对象。')
  }
  const source = value as Record<string, unknown>
  const unknownKeys = Object.keys(source).filter((key) => !SITE_FEATURE_KEYS.includes(key as never))
  if (unknownKeys.length > 0) throw new Error(`存在未知功能开关：${unknownKeys.join('、')}。`)
  const features = {} as SiteFeatures
  for (const key of SITE_FEATURE_KEYS) {
    if (typeof source[key] !== 'boolean') throw new Error(`功能开关 ${key} 必须是布尔值。`)
    features[key] = source[key]
  }
  return features
}

export async function getSiteFeatureSettings(): Promise<AdminSiteFeatureSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: SiteFeatureSettingsV1; revision: number }>(
    'select record_json, revision from feature_settings where key = $1',
    [FEATURE_SETTINGS_KEY],
  )
  const row = result.rows[0]
  return { ...normalizeSiteFeatureSettings(row?.record_json), revision: row?.revision ?? 0 }
}

export async function saveSiteFeatureSettings(features: SiteFeatures, expectedRevision: number): Promise<AdminSiteFeatureSettingsV1> {
  await ensureSchema()
  const saved: SiteFeatureSettingsV1 = {
    version: 1,
    features: { ...features },
    updated_at: new Date().toISOString(),
  }
  const result = await query<{ revision: number }>(
    `with updated as (
       update feature_settings
       set record_json = $2::jsonb, updated_at = $3::timestamptz, revision = revision + 1
       where key = $1 and revision = $4
       returning revision
     ), inserted as (
       insert into feature_settings (key, record_json, updated_at, revision)
       select $1, $2::jsonb, $3::timestamptz, 1
       where $4 = 0 and not exists (select 1 from feature_settings where key = $1)
       on conflict (key) do nothing
       returning revision
     )
     select revision from updated
     union all
     select revision from inserted`,
    [FEATURE_SETTINGS_KEY, JSON.stringify(saved), saved.updated_at, expectedRevision],
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
