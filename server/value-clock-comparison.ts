import { createHash } from 'node:crypto'
import { canonicalJson } from '../src/lib/crypto'
import { createManualPlans, manualResult } from '../src/lib/manual-schedule'
import { VALUE_CLOCK_METRICS, type ValueClockVector } from '../src/lib/value-clock'
import type { WorkspaceResultHistoryExportItem } from '../src/lib/types'
import { normalizePersistedOptimizationJobPayload } from './optimization/jobs/shared'
import { parseOptimizeResult } from './optimization/jobs/runtime-contracts'
import type { OptimizeJobRecord } from './storage/optimize-job-store'
import { freezeValueClockProduction } from './value-clock-production'

export class ValueClockComparisonError extends Error {
  constructor(message: string, readonly code = 'comparison_reassessment_required') { super(message) }
}

export function verifyValueClockComparison(profileId: string, current: WorkspaceResultHistoryExportItem, baseline: WorkspaceResultHistoryExportItem,
  jobs: [OptimizeJobRecord, OptimizeJobRecord], importedAt: string | null) {
  if (current.id === baseline.id || Date.parse(baseline.created_at) > Date.parse(current.created_at)) throw new ValueClockComparisonError('请选择使用网站新方案之前的原排班。')
  const proofs = jobs.map((job, index) => {
    if (job.profile_id !== profileId || job.status !== 'succeeded' || !job.result_json) throw new ValueClockComparisonError('核算尚未完成，请重新核算。')
    const payload = normalizePersistedOptimizationJobPayload(job.payload_json)
    if ('kind' in payload || payload.request.manual_schedule_purpose !== 'comparison' || !payload.request.manual_schedule) throw new ValueClockComparisonError('请在当前条件下核算两份排班。')
    const source = index === 0 ? current : baseline
    const schedule = (result: typeof source.result) => {
      const normalized = manualResult(result, createManualPlans(result))
      return { ...normalized, author: undefined, title: undefined, description: undefined }
    }
    if (canonicalJson(schedule(source.result)) !== canonicalJson(schedule(payload.request.manual_schedule))) throw new ValueClockComparisonError('核算的人员安排与所选历史排班不一致，请重新核算。')
    const result = parseOptimizeResult(job.result_json)
    if (!result.build_meta) throw new ValueClockComparisonError('核算版本信息缺失，请重新核算。')
    const context = canonicalJson({ operators: payload.operators, config: payload.effectiveConfig,
      backend: result.build_meta.backend_version, data: result.build_meta.data_version, git: result.build_meta.git_sha, metric: 'production-sanity-v1' })
    const frozen = freezeValueClockProduction({ ...source, config: payload.effectiveConfig, result }, importedAt)
    return { context, frozen }
  })
  if (proofs[0].context !== proofs[1].context) throw new ValueClockComparisonError('两份排班的干员或设施条件不同，请在同一条件下重新核算。')
  const [after, before] = proofs.map((proof) => proof.frozen)
  const daily = Object.fromEntries(VALUE_CLOCK_METRICS.map((key) => [key, after.daily[key] - before.daily[key]])) as ValueClockVector
  return { daily, currentDaily: after.daily.sanity, baselineDaily: before.daily.sanity,
    fingerprint: createHash('sha256').update(proofs[0].context).digest('hex'), inventorySnapshot: before.inventorySnapshot,
    inventoryDurationMs: Math.min(after.inventory?.durationMs ?? Infinity, before.inventory?.durationMs ?? Infinity) }
}
