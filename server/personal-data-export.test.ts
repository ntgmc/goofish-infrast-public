import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERSONAL_DATA_EXPORT_COVERAGE } from './personal-data-export'

describe('personal data export coverage matrix', () => {
  it('classifies every table with a direct user, profile, or owner association', () => {
    const schema = readFileSync(new URL('./storage/schema.ts', import.meta.url), 'utf8')
    const relatedTables = new Set<string>([
      'user_accounts',
      'optimize_job_attempts',
      'optimization_job_effects',
      'depot_value_samples',
      'account_deletion_email_outbox',
    ])
    const tablePattern = /CREATE TABLE IF NOT EXISTS ([a-z0-9_]+) \((.*?)\n\);/gs
    for (const match of schema.matchAll(tablePattern)) {
      const [, table, definition] = match
      if (/\b(?:user_id|profile_id|owner_key|inviter_user_id|invitee_user_id|consumed_by_user_id)\b/.test(definition)) {
        relatedTables.add(table)
      }
    }

    const uncovered = [...relatedTables]
      .filter((table) => !(table in PERSONAL_DATA_EXPORT_COVERAGE))
      .sort()
    expect(uncovered).toEqual([])
  })

  it('gives every exclusion a concrete reason', () => {
    for (const entry of Object.values(PERSONAL_DATA_EXPORT_COVERAGE)) {
      if (entry.disposition === 'exclude') expect(entry.reason.trim().length).toBeGreaterThan(10)
    }
  })
})
