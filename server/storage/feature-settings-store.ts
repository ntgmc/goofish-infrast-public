import type { SiteFeatureSettingsV1, SiteFeatures } from '../../src/lib/site-features'
import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  SITE_FEATURE_KEYS,
  normalizeSiteFeatureSettings,
} from '../../src/lib/site-features'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

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

export async function getSiteFeatureSettings(): Promise<SiteFeatureSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: SiteFeatureSettingsV1 }>(
    'select record_json from feature_settings where key = $1',
    [FEATURE_SETTINGS_KEY],
  )
  return normalizeSiteFeatureSettings(result.rows[0]?.record_json)
}

export async function saveSiteFeatureSettings(features: SiteFeatures): Promise<SiteFeatureSettingsV1> {
  await ensureSchema()
  const saved: SiteFeatureSettingsV1 = {
    version: 1,
    features: { ...features },
    updated_at: new Date().toISOString(),
  }
  await query(
    `insert into feature_settings (key, record_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set record_json = excluded.record_json, updated_at = now()`,
    [FEATURE_SETTINGS_KEY, JSON.stringify(saved)],
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
