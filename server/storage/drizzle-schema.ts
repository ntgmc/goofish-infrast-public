import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { SiteFeatureSettingsV1 } from '../../src/lib/site-features'

// Runtime mapping only; schema.ts remains the database migration owner.
export const featureSettings = pgTable(
  'feature_settings',
  {
    key: text('key').primaryKey(),
    recordJson: jsonb('record_json').$type<SiteFeatureSettingsV1>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [check('feature_settings_revision_check', sql`${table.revision} >= 1`)],
)
