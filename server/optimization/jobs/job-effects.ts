import type { OptimizeResult } from '../../../src/lib/types'
import { recordGeneratedBehaviorEvent } from '../../behavior-risk/service'
import { getTrackedGenerationEvent } from '../../storage/behavior-risk-store'
import { hasDatabaseUrl, query } from '../../storage/postgres'
import { applyScheduleGenerateEffects } from './entitlements'
import { normalizePersistedOptimizationJobPayload } from './shared'
import { parseOptimizationJobResult } from './runtime-contracts'

type PendingScheduleEffectRow = {
  job_id: string
  payload_json: unknown
  result_json: unknown
  profile_id: string | null
  started_at: string | Date | null
  user_id: string | null
  profile_record: Record<string, unknown> | null
}

export async function processPendingOptimizationJobEffects(jobId?: string): Promise<number> {
  if (!hasDatabaseUrl()) return 0
  const pending = await query<PendingScheduleEffectRow>(
    `select effect.job_id, job.payload_json, job.result_json, job.profile_id, job.started_at,
            profile.user_id, profile.record_json as profile_record
     from optimization_job_effects effect
     join optimize_jobs job on job.id = effect.job_id
     left join user_game_accounts profile on profile.id = job.profile_id
     where effect.effect_type = 'schedule_completion'
       and coalesce(effect.metadata_json->>'status', 'pending') = 'pending'
       and job.status = 'succeeded'
       and ($1::text is null or effect.job_id = $1)
     order by effect.applied_at asc
     limit 25`,
    [jobId ?? null],
  )
  let applied = 0
  for (const row of pending.rows) {
    try {
      await applyScheduleCompletionEffect(row)
      await query(
        `update optimization_job_effects
         set metadata_json = metadata_json || $3::jsonb, applied_at = $2
         where job_id = $1 and effect_type = 'schedule_completion'`,
        [row.job_id, new Date().toISOString(), JSON.stringify({ status: 'applied', last_error: null })],
      )
      applied += 1
    } catch (error) {
      const message = sanitizeEffectError(error)
      await query(
        `update optimization_job_effects
         set metadata_json = jsonb_set(
           metadata_json || $2::jsonb,
           '{attempts}',
           to_jsonb(coalesce(nullif(metadata_json->>'attempts', '')::integer, 0) + 1),
           true
         )
         where job_id = $1 and effect_type = 'schedule_completion'`,
        [row.job_id, JSON.stringify({ status: 'pending', last_error: message, last_attempt_at: new Date().toISOString() })],
      ).catch(() => undefined)
      console.warn(`[optimization-job-effect] ${row.job_id} remains pending: ${message}`)
    }
  }
  return applied
}

async function applyScheduleCompletionEffect(row: PendingScheduleEffectRow): Promise<void> {
  const payload = normalizePersistedOptimizationJobPayload(row.payload_json)
  if ('kind' in payload) throw new Error(`Unexpected schedule effect for ${payload.kind}.`)
  if (!row.profile_id || !row.user_id) throw new Error('Schedule effect is missing its profile owner.')
  const result = parseOptimizationJobResult(payload, row.result_json) as OptimizeResult
  await applyScheduleGenerateEffects(
    payload.cdkUsageRef,
    {
      ...payload.scheduleUsageBase,
      profile_id: row.profile_id,
      status: 'success',
      reason_code: 'ok',
      source: payload.scheduleUsageBase.source ?? 'optimize',
    },
    {
      submittedAt: payload.submittedAt,
      ...(row.started_at && { attemptStartedAt: Date.parse(String(row.started_at)) }),
    },
    row.job_id,
  )
  const recorded = await recordGeneratedBehaviorEvent({
    userId: row.user_id,
    profileId: row.profile_id,
    jobId: row.job_id,
    uid: readProfileUid(row.profile_record),
    result,
  })
  if (!recorded && !await getTrackedGenerationEvent(row.user_id, row.profile_id, row.job_id)) {
    throw new Error('Generate behavior event was not recorded.')
  }
}

function readProfileUid(record: Record<string, unknown> | null): string | null {
  const binding = record?.skland_binding
  return binding && typeof binding === 'object' && !Array.isArray(binding)
    && typeof (binding as Record<string, unknown>).uid === 'string'
    ? (binding as Record<string, unknown>).uid as string
    : null
}

function sanitizeEffectError(error: unknown): string {
  const value = (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
  return value.length <= 1_000 ? value : `${value.slice(0, 999)}…`
}
