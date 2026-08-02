import { hasDatabaseUrl, query } from './postgres'
import { ensureDatabaseSchema } from './schema'

export interface DepotValueSampleRecord {
  version: 2
  uid_hash: string
  uid_hash_key_version: string
  contributor_profile_id?: string | null
  valuation_version: string
  pricing_snapshot_id: string
  pricing_fetched_at: string
  pricing_status: 'fresh' | 'stale'
  pricing_coverage: number
  complete: true
  total_equivalent_sanity: number
  account_level: number | null
  operator_power_score: number
  operator_count: number
  elite2_count: number
  six_star_count: number
  six_star_e2_count: number
  e2_90_count: number
  inventory_item_count: number
  priced_count: number
  unpriced_count: number
  sample_json: Record<string, unknown>
  sampled_at: string
  updated_at: string
}

interface DepotValueSampleDistribution {
  sample_count: number
  less_count: number
  equal_count: number
}

export interface DepotValueSampleStore {
  save: (record: DepotValueSampleRecord, previousUidHashes?: string[]) => Promise<void>
  getDistribution: (totalEquivalentSanity: number, valuationVersion: string) => Promise<DepotValueSampleDistribution>
  deleteForContributorProfile: (profileId: string) => Promise<number>
}

let schemaReady: Promise<void> | null = null

export function getDepotValueSampleStore(): DepotValueSampleStore | null {
  const testingStore = getTestingDepotValueSampleStore()
  if (testingStore) return testingStore
  if (!hasDatabaseUrl()) return null
  return createPostgresDepotValueSampleStore()
}

function createPostgresDepotValueSampleStore(): DepotValueSampleStore {
  return {
    save: async (record, previousUidHashes = []) => {
      await ensureSchema()
      await query(
        `with removed_previous_keys as (
           delete from depot_value_samples
            where uid_hash = any($25::text[]) and uid_hash <> $1
         )
         insert into depot_value_samples
          (uid_hash, uid_hash_key_version, contributor_profile_id, version, valuation_version, pricing_snapshot_id,
           pricing_fetched_at, pricing_status, pricing_coverage, complete,
           total_equivalent_sanity, account_level, operator_power_score, operator_count, elite2_count,
           six_star_count, six_star_e2_count, e2_90_count, inventory_item_count, priced_count, unpriced_count,
           sample_json, sampled_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23, $24)
         on conflict (uid_hash) do update set
           uid_hash_key_version = excluded.uid_hash_key_version,
           contributor_profile_id = excluded.contributor_profile_id,
           version = excluded.version,
           valuation_version = excluded.valuation_version,
           pricing_snapshot_id = excluded.pricing_snapshot_id,
           pricing_fetched_at = excluded.pricing_fetched_at,
           pricing_status = excluded.pricing_status,
           pricing_coverage = excluded.pricing_coverage,
           complete = excluded.complete,
           total_equivalent_sanity = excluded.total_equivalent_sanity,
           account_level = excluded.account_level,
           operator_power_score = excluded.operator_power_score,
           operator_count = excluded.operator_count,
           elite2_count = excluded.elite2_count,
           six_star_count = excluded.six_star_count,
           six_star_e2_count = excluded.six_star_e2_count,
           e2_90_count = excluded.e2_90_count,
           inventory_item_count = excluded.inventory_item_count,
           priced_count = excluded.priced_count,
           unpriced_count = excluded.unpriced_count,
           sample_json = excluded.sample_json,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at`,
        [
          record.uid_hash,
          record.uid_hash_key_version,
          record.contributor_profile_id ?? null,
          record.version,
          record.valuation_version,
          record.pricing_snapshot_id,
          record.pricing_fetched_at,
          record.pricing_status,
          record.pricing_coverage,
          record.complete,
          record.total_equivalent_sanity,
          record.account_level,
          record.operator_power_score,
          record.operator_count,
          record.elite2_count,
          record.six_star_count,
          record.six_star_e2_count,
          record.e2_90_count,
          record.inventory_item_count,
          record.priced_count,
          record.unpriced_count,
          JSON.stringify(record.sample_json),
          record.sampled_at,
          record.updated_at,
          previousUidHashes,
        ],
      )
    },
    getDistribution: async (totalEquivalentSanity, valuationVersion) => {
      await ensureSchema()
      const result = await query<{
        sample_count: number
        less_count: number
        equal_count: number
      }>(
        `with current_samples as (
           select distinct on (coalesce(contributor_profile_id, uid_hash)) total_equivalent_sanity
             from depot_value_samples
            where version = 2 and complete = true and valuation_version = $2
            order by coalesce(contributor_profile_id, uid_hash), sampled_at desc, updated_at desc
         )
         select
           count(*)::int as sample_count,
           count(*) filter (where total_equivalent_sanity < $1)::int as less_count,
           count(*) filter (where total_equivalent_sanity = $1)::int as equal_count
         from current_samples`,
        [totalEquivalentSanity, valuationVersion],
      )
      return {
        sample_count: result.rows[0]?.sample_count ?? 0,
        less_count: result.rows[0]?.less_count ?? 0,
        equal_count: result.rows[0]?.equal_count ?? 0,
      }
    },
    deleteForContributorProfile: async (profileId) => {
      await ensureSchema()
      const result = await query('delete from depot_value_samples where contributor_profile_id = $1', [profileId])
      return result.rowCount ?? 0
    },
  }
}

function getTestingDepotValueSampleStore(): DepotValueSampleStore | null {
  if (process.env.NODE_ENV === 'production') return null
  return (
    (globalThis as unknown as { __maaDepotValueSampleStoreForTesting?: DepotValueSampleStore })
      .__maaDepotValueSampleStoreForTesting ?? null
  )
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
