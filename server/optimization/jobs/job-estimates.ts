import type { LicenseConfig, OptimizeEstimateBucket } from '../../../src/lib/types';
import { SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT } from '../../../src/lib/scenario-comparison';
import { getScheduleGenerateDurationStatsByBucket } from '../../handlers/usage-stats';
import type { OptimizeJobSummaryRecord } from '../../storage/optimize-job-store';
import { isOptimizeEstimateOverdue } from '../../optimize-estimate';
import { getOptimizeJobHardTimeoutMs } from '../../optimize-job-config';
import type { OptimizeDurationEstimate, OptimizeRuntimeEstimate, OptimizationJobPayload } from './shared';
import { OPTIMIZE_ESTIMATE_FALLBACK_MS, OPTIMIZE_ESTIMATE_MIN_MS, OPTIMIZE_ESTIMATE_MIN_SAMPLES, OPTIMIZE_ESTIMATE_HISTORY_DAYS } from './shared';

export function getOptimizeJobEstimate(job: OptimizeJobSummaryRecord): OptimizeDurationEstimate {
  const payload = job.payload_json as Partial<OptimizationJobPayload> | null;
  if (isOptimizeDurationEstimate(payload?.estimate)) return payload.estimate;
  const withSuggestions = payload != null && 'request' in payload
    && payload.request?.include_upgrade_suggestions === true
    && payload.request.upgrade_suggestions_allowed === true;
  const bucket = payload?.effectiveConfig
    ? getOptimizeEstimateBucket(payload.effectiveConfig, withSuggestions)
    : withSuggestions ? 'maa_plain_with_suggestions' : 'maa_plain';
  return buildFallbackOptimizeEstimate(bucket);
}

export function getOptimizeRuntimeEstimate(
  job: OptimizeJobSummaryRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  now = new Date(),
  queueWaitMs: number | null = null,
): OptimizeRuntimeEstimate {
  const nowMs = now.getTime();
  const submittedMs = parseOptimizeJobTime(job.created_at, nowMs);
  const submittedElapsedMs = Math.max(0, nowMs - submittedMs);
  const baseMs = Math.max(OPTIMIZE_ESTIMATE_MIN_MS, estimate.estimated_duration_ms);
  const estimate_updated_at = now.toISOString();

  if (job.status === 'failed' || job.status === 'dead_lettered') {
    return {
      estimated_remaining_ms: null,
      estimated_total_ms: null,
      estimate_phase: 'failed',
      estimate_updated_at,
    };
  }

  if (job.status === 'cancelled') {
    return {
      estimated_remaining_ms: null,
      estimated_total_ms: null,
      estimate_phase: 'cancelled',
      estimate_updated_at,
    };
  }

  if (job.status === 'succeeded') {
    const finishedMs = parseOptimizeJobTime(job.finished_at, nowMs);
    return {
      estimated_remaining_ms: 0,
      estimated_total_ms: Math.max(0, finishedMs - submittedMs),
      estimate_phase: 'completed',
      estimate_updated_at,
    };
  }

  if (job.status === 'running' || (job.status === 'queued' && job.started_at)) {
    const startedMs = parseOptimizeJobTime(job.started_at, nowMs);
    const queueElapsedMs = Math.max(0, startedMs - submittedMs);
    const runningElapsedMs = Math.max(0, nowMs - startedMs);
    if (isOptimizeEstimateOverdue(runningElapsedMs, baseMs)) {
      return {
        estimated_remaining_ms: null,
        estimated_total_ms: Math.max(submittedElapsedMs, queueElapsedMs + baseMs),
        estimate_phase: 'overdue',
        estimate_updated_at,
      };
    }
    return {
      estimated_remaining_ms: Math.max(1_000, baseMs - runningElapsedMs),
      estimated_total_ms: queueElapsedMs + baseMs,
      estimate_phase: 'running',
      estimate_updated_at,
    };
  }

  const position = Math.max(1, queuePosition ?? 1);
  const queueEstimateMs = queueWaitMs === null
    ? baseMs * position
    : Math.max(0, queueWaitMs) + baseMs;
  const estimatedRemainingMs = queueWaitMs === null
    ? Math.max(1_000, queueEstimateMs - submittedElapsedMs)
    : Math.max(1_000, queueEstimateMs);
  return {
    estimated_remaining_ms: estimatedRemainingMs,
    estimated_total_ms: Math.max(queueEstimateMs, submittedElapsedMs + estimatedRemainingMs),
    estimate_phase: 'queued',
    estimate_updated_at,
  };
}

function parseOptimizeJobTime(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isOptimizeDurationEstimate(value: unknown): value is OptimizeDurationEstimate {
  if (!value || typeof value !== 'object') return false;
  const estimate = value as Partial<OptimizeDurationEstimate>;
  return typeof estimate.estimated_duration_ms === 'number'
    && isOptimizeEstimateBucket(estimate.estimate_bucket)
    && (estimate.estimate_source === 'history_p95' || estimate.estimate_source === 'fallback_p95')
    && typeof estimate.estimate_sample_count === 'number';
}

function isOptimizeEstimateBucket(value: unknown): value is OptimizeEstimateBucket {
  return value === 'maa_fiammetta'
    || value === 'maa_fiammetta_with_suggestions'
    || value === 'maa_plain'
    || value === 'maa_plain_with_suggestions'
    || value === 'rotation'
    || value === 'rotation_with_suggestions'
    || value === 'scenario_comparison';
}

export function getOptimizeEstimateBucket(config: LicenseConfig, includeUpgradeSuggestions = false): OptimizeEstimateBucket {
  const mode = String(config.schedule_mode ?? 'maa').toLowerCase();
  if (mode === 'rotation') return includeUpgradeSuggestions ? 'rotation_with_suggestions' : 'rotation';
  if (config.Fiammetta?.enable === true) {
    return includeUpgradeSuggestions ? 'maa_fiammetta_with_suggestions' : 'maa_fiammetta';
  }
  return includeUpgradeSuggestions ? 'maa_plain_with_suggestions' : 'maa_plain';
}

export function getEstimateScheduleMode(bucket: OptimizeEstimateBucket): 'maa' | 'rotation' {
  return bucket === 'rotation' || bucket === 'rotation_with_suggestions' ? 'rotation' : 'maa';
}

export function isEstimateFiammettaEnabled(bucket: OptimizeEstimateBucket): boolean {
  return bucket === 'maa_fiammetta' || bucket === 'maa_fiammetta_with_suggestions';
}

export async function resolveOptimizeDurationEstimate(bucket: OptimizeEstimateBucket): Promise<OptimizeDurationEstimate> {
  const fallback = buildFallbackOptimizeEstimate(bucket);
  if (bucket === 'scenario_comparison') return fallback;
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - OPTIMIZE_ESTIMATE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  try {
    const stats = await getScheduleGenerateDurationStatsByBucket(bucket, startAt.toISOString(), endAt.toISOString());
    if (stats.sample_count >= OPTIMIZE_ESTIMATE_MIN_SAMPLES && stats.p95_ms > 0) {
      return {
        estimated_duration_ms: clampOptimizeEstimateMs(stats.p95_ms),
        estimate_bucket: bucket,
        estimate_source: 'history_p95',
        estimate_sample_count: stats.sample_count,
      };
    }
    return { ...fallback, estimate_sample_count: stats.sample_count };
  } catch (error) {
    console.warn('optimize duration estimate fallback used:', error);
    return fallback;
  }
}

export function buildScenarioComparisonEstimate(scenarioCount: number, variableScenarioCount = 0): OptimizeDurationEstimate {
  const count = Math.max(1, Math.min(24, Math.floor(scenarioCount)))
  const variableCount = Math.max(0, Math.min(count, Math.floor(variableScenarioCount)))
  const fixedCount = count - variableCount
  const estimatedVerifications = Math.min(9, count)
  return {
    estimated_duration_ms: Math.max(
      OPTIMIZE_ESTIMATE_MIN_MS,
      Math.round(fixedCount * 4_000 + variableCount * SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT * 4_000 + estimatedVerifications * 9_000),
    ),
    estimate_bucket: 'scenario_comparison',
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  }
}

function buildFallbackOptimizeEstimate(bucket: OptimizeEstimateBucket): OptimizeDurationEstimate {
  return {
    estimated_duration_ms: clampOptimizeEstimateMs(OPTIMIZE_ESTIMATE_FALLBACK_MS[bucket]),
    estimate_bucket: bucket,
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  };
}

function clampOptimizeEstimateMs(value: number, maxMs = getOptimizeJobHardTimeoutMs()): number {
  if (!Number.isFinite(value)) return OPTIMIZE_ESTIMATE_FALLBACK_MS.maa_plain;
  return Math.max(OPTIMIZE_ESTIMATE_MIN_MS, Math.min(maxMs, Math.round(value)));
}
