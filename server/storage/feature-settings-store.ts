import type { AdminSiteFeatureSettingsV1, SiteFeatureSettingsV1, SiteFeatures } from '../../src/lib/site-features'
import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  SITE_FEATURE_KEYS,
  normalizeSiteFeatureSettings,
} from '../../src/lib/site-features'
import { and, eq, sql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { featureSettings } from './drizzle-schema'
import { retryPostgresQuery } from './postgres'
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
  const rows = await retryPostgresQuery(() => getDrizzle()
    .select({ recordJson: featureSettings.recordJson, revision: featureSettings.revision })
    .from(featureSettings)
    .where(eq(featureSettings.key, FEATURE_SETTINGS_KEY)))
  const row = rows[0]
  return { ...normalizeSiteFeatureSettings(row?.recordJson), revision: row?.revision ?? 0 }
}

export async function saveSiteFeatureSettings(features: SiteFeatures, expectedRevision: number): Promise<AdminSiteFeatureSettingsV1> {
  await ensureSchema()
  const updatedAt = new Date().toISOString()
  const saved: SiteFeatureSettingsV1 = {
    version: 1,
    features: { ...features },
    updated_at: updatedAt,
  }
  const values = { recordJson: saved, updatedAt }
  const rows = await retryPostgresQuery(() => expectedRevision === 0
    ? getDrizzle().insert(featureSettings)
      .values({ key: FEATURE_SETTINGS_KEY, ...values, revision: 1 })
      .onConflictDoNothing({ target: featureSettings.key })
      .returning({ revision: featureSettings.revision })
    : getDrizzle().update(featureSettings)
      .set({ ...values, revision: sql`${featureSettings.revision} + 1` })
      .where(and(eq(featureSettings.key, FEATURE_SETTINGS_KEY), eq(featureSettings.revision, expectedRevision)))
      .returning({ revision: featureSettings.revision }))
  const revision = rows[0]?.revision
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
