import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleProgressState } from '../../../../components/ScheduleProgress'
import { apiJson } from '../../../../lib/api-client'
import { getOptimizePollRetryDelayMs } from '../../../../lib/optimize-poll'
import type {
  CreateOptimizationJobRequest,
  CreateScenarioComparisonJobResponse,
  ScenarioComparisonJobSnapshot,
} from '../../../../lib/optimization-contracts'
import type { ScenarioComparisonFactors, ScenarioComparisonResult } from '../../../../lib/scenario-comparison'
import type { IssuedMeteredScheduleQuote } from '../../../../lib/metered-billing'
import {
  scenarioComparisonFactorsSchema,
  scenarioComparisonResultSchema,
} from '../../../../lib/scenario-comparison-validation'
import type { LicenseConfig, LicenseOperator } from '../../../../lib/types'
import { copy } from '../../../../copy/index'
import { fetchOptimizeJobSnapshotStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, waitForOptimizePoll } from '../job-progress'
import { cancelOptimizationJob, OPTIMIZE_SUBMIT_TIMEOUT_MS } from '../optimization-api'
import { publishOptimizationJobUpdate, subscribeOptimizationJobUpdates, withOptimizationSubmissionLock } from '../optimization-job-events'
import { z } from 'zod'


const DEFAULT_FACTORS: ScenarioComparisonFactors = {
  layouts: [{
    layout: '243',
    plans: [{
      trading: { lmd: 2, orundum: 0 },
      manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 },
    }],
  }],
  maaSchedules: ['variable', '8x3'],
  includeRotation: true,
  droneStrategies: ['off', 'auto'],
}

interface StoredScenarioSession {
  factors: ScenarioComparisonFactors;
  activeJobId?: string;
  result?: ScenarioComparisonResult;
  pendingSubmission?: { requestJson: string; idempotencyKey: string };
}

const storedScenarioSessionSchema: z.ZodType<StoredScenarioSession> = z.strictObject({
  factors: scenarioComparisonFactorsSchema,
  activeJobId: z.string().min(1).max(256).optional(),
  result: scenarioComparisonResultSchema.optional(),
  pendingSubmission: z.strictObject({
    requestJson: z.string().min(1).max(512 * 1024),
    idempotencyKey: z.string().min(1).max(200),
  }).optional(),
})

export function useScenarioComparison({
  profileId,
  operators,
  config,
  onSettled,
}: {
  profileId: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  onSettled?: () => void | Promise<void>;
}) {
  const initial = useMemo(() => readSession(profileId), [profileId])
  const [factors, setFactorsState] = useState<ScenarioComparisonFactors>(initial?.factors ?? DEFAULT_FACTORS)
  const [result, setResult] = useState<ScenarioComparisonResult | null>(initial?.result ?? null)
  const [job, setJob] = useState<ScenarioComparisonJobSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(initial?.activeJobId))
  const [cancelling, setCancelling] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('connected')
  const [consecutivePollFailures, setConsecutivePollFailures] = useState(0)
  const pollRunRef = useRef(0)

  const setFactors = useCallback((next: ScenarioComparisonFactors) => {
    setFactorsState(next)
    writeSession(profileId, { factors: next, ...(result ? { result } : {}) })
  }, [profileId, result])

  const pollJob = useCallback(async (
    jobId: string,
    runId: number,
    sessionFactors: ScenarioComparisonFactors,
  ) => {
    let failures = 0
    let terminalRefreshRequested = false
    const unsubscribe = subscribeOptimizationJobUpdates((event) => {
      if (
        event.profileId === profileId
        && event.jobId === jobId
        && (event.status === 'succeeded' || event.status === 'failed' || event.status === 'cancelled' || event.status === 'dead_lettered')
      ) {
        terminalRefreshRequested = true
      }
    })
    const consumeTerminalRefresh = () => {
      if (!terminalRefreshRequested) return false
      terminalRefreshRequested = false
      return true
    }

    try {
      while (pollRunRef.current === runId) {
        try {
          const snapshot = await fetchOptimizeJobSnapshotStatus<ScenarioComparisonResult>(
            jobId,
            copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_001,
            undefined,
            () => pollRunRef.current !== runId,
          ) as ScenarioComparisonJobSnapshot
          if (pollRunRef.current !== runId) return
          failures = 0
          setConnectionStatus('connected')
          setConsecutivePollFailures(0)
          setJob(snapshot)
          publishOptimizationJobUpdate(profileId, snapshot)
          if (snapshot.status === 'succeeded') {
            setResult(snapshot.result)
            writeSession(profileId, { factors: sessionFactors, result: snapshot.result })
            await settleInventory(onSettled, setError)
            if (pollRunRef.current === runId) setLoading(false)
            return
          }
          if (snapshot.status === 'failed' || snapshot.status === 'cancelled' || snapshot.status === 'dead_lettered') {
            if (snapshot.status === 'cancelled') {
              setError(null)
            } else {
              const supportSuffix = snapshot.error.supportReference ? ` (${snapshot.error.supportReference})` : ''
              setError(`${snapshot.error.message}${supportSuffix}`)
            }
            writeSession(profileId, { factors: sessionFactors })
            await settleInventory(onSettled, setError)
            if (pollRunRef.current === runId) setLoading(false)
            return
          }
          await waitForOptimizePoll(
            snapshot.pollAfterMs || (snapshot.status === 'queued' ? 3_000 : 1_500),
            () => pollRunRef.current !== runId,
            consumeTerminalRefresh,
          )
        } catch (caught) {
          if (isOptimizeJobPollCancelled(caught) || pollRunRef.current !== runId) return
          if (!isRetryableOptimizePollError(caught)) {
            setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_002)
            writeSession(profileId, { factors: sessionFactors })
            await settleInventory(onSettled, setError)
            if (pollRunRef.current === runId) setLoading(false)
            return
          }
          failures += 1
          setConnectionStatus('reconnecting')
          setConsecutivePollFailures(failures)
          await waitForOptimizePoll(
            getOptimizePollRetryDelayMs(failures),
            () => pollRunRef.current !== runId,
            consumeTerminalRefresh,
          )
        }
      }
    } finally {
      unsubscribe()
    }
  }, [onSettled, profileId])
  const pollJobRef = useRef(pollJob)

  useEffect(() => {
    pollJobRef.current = pollJob
  }, [pollJob])

  const run = useCallback(async (useCoupon = false, billingQuote: IssuedMeteredScheduleQuote | null = null) => {
    setError(null)
    setLoading(true)
    setResult(null)
    const request: CreateOptimizationJobRequest = {
      kind: 'scenario_comparison',
      identity: { type: 'profile', profileId },
      operators,
      config,
      factors,
      ...(useCoupon && { use_items: ['scenario_simulation_coupon'] }),
      ...(billingQuote && {
        billing_quote_id: billingQuote.quote_id,
        pricing_version: billingQuote.pricing_version,
        accepted_max_points: billingQuote.charge,
      }),
    }
    const requestJson = JSON.stringify(request)
    const previousPending = readSession(profileId)?.pendingSubmission
    const pendingSubmission = previousPending?.requestJson === requestJson
      ? previousPending
      : { requestJson, idempotencyKey: crypto.randomUUID() }
    writeSession(profileId, { factors, pendingSubmission })
    try {
      const response = await withOptimizationSubmissionLock(profileId, async () => (
        await apiJson<CreateScenarioComparisonJobResponse>('/api/optimization/jobs', {
          method: 'POST',
          headers: { 'Idempotency-Key': pendingSubmission.idempotencyKey },
          json: request,
          signal: AbortSignal.timeout(OPTIMIZE_SUBMIT_TIMEOUT_MS),
          fallbackMessage: copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_003,
        })
      ))
      const nextJob = response.job
      setJob(nextJob)
      publishOptimizationJobUpdate(profileId, nextJob)
      writeSession(profileId, { factors, activeJobId: nextJob.id })
      pollRunRef.current += 1
      await pollJob(nextJob.id, pollRunRef.current, factors)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_004)
      writeSession(profileId, { factors, pendingSubmission })
      await settleInventory(onSettled, setError)
      setLoading(false)
    }
  }, [config, factors, onSettled, operators, pollJob, profileId])

  const cancel = useCallback(async () => {
    if (!job?.canCancel || cancelling) return
    setCancelling(true)
    setError(null)
    try {
      const snapshot = await cancelOptimizationJob(job.id) as ScenarioComparisonJobSnapshot
      setJob(snapshot)
      publishOptimizationJobUpdate(profileId, snapshot)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_002)
    } finally {
      setCancelling(false)
    }
  }, [cancelling, job, profileId])

  useEffect(() => {
    const restored = readSession(profileId)
    const restoredFactors = restored?.factors ?? DEFAULT_FACTORS
    setFactorsState(restoredFactors)
    setResult(restored?.result ?? null)
    setError(null)
    setJob(null)
    setLoading(Boolean(restored?.activeJobId))
    setConnectionStatus('connected')
    setConsecutivePollFailures(0)
    pollRunRef.current += 1
    const runId = pollRunRef.current
    if (restored?.activeJobId) void pollJobRef.current(restored.activeJobId, runId, restoredFactors)
    return () => {
      if (pollRunRef.current === runId) pollRunRef.current += 1
    }
  }, [profileId])

  const progress = useMemo<ScheduleProgressState | null>(() => job && (loading || job.status === 'cancelled') ? {
    mode: 'scenario',
    startedAt: Date.parse(job.timestamps.submittedAt),
    queueStatus: job.status === 'queued' ? 'queued' : job.status === 'running' ? 'running' : undefined,
    queuePosition: job.queuePosition,
    priority: job.priority.kind,
    jobId: job.id,
    observedRunning: job.status === 'running',
    estimatedDurationMs: job.estimate.durationMs,
    estimatedRemainingMs: job.estimate.remainingMs,
    estimatedTotalMs: job.estimate.totalMs,
    estimatePhase: job.estimate.phase,
    estimateUpdatedAt: job.estimate.updatedAt,
    lastUpdatedAt: Date.now(),
    connectionStatus,
    consecutivePollFailures,
    executionPhase: job.executionPhase,
    attemptCount: job.attemptCount,
    nextAttemptAt: job.timestamps.nextAttemptAt,
    cancellationRequested: job.cancellationRequested,
  } : null, [connectionStatus, consecutivePollFailures, job, loading])

  return { factors, setFactors, result, error, loading, cancelling, canCancel: Boolean(job?.canCancel), progress, run, cancel }
}

function sessionKey(profileId: string): string {
  return `maa:scenario-lab:v2:${profileId}`
}

export function restoreScenarioComparisonJob(profileId: string, jobId: string): void {
  const current = readSession(profileId)
  writeSession(profileId, {
    factors: current?.factors ?? DEFAULT_FACTORS,
    activeJobId: jobId,
  })
}

function readSession(profileId: string): StoredScenarioSession | null {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(profileId))
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clearInvalidSession(profileId)
    const candidate = value as Record<string, unknown>
    const factors = normalizeStoredFactors(candidate.factors)
    if (!factors) return clearInvalidSession(profileId)
    const parsed = storedScenarioSessionSchema.safeParse({ ...candidate, factors })
    return parsed.success ? parsed.data : clearInvalidSession(profileId)
  } catch {
    return clearInvalidSession(profileId)
  }
}

function normalizeStoredFactors(value: unknown): ScenarioComparisonFactors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const factors = value as Record<string, unknown>
  const maaSchedules = Array.isArray(factors.maaSchedules)
    ? factors.maaSchedules.filter((entry) => entry === 'variable' || entry === '8x3')
    : [...DEFAULT_FACTORS.maaSchedules]
  const parsed = scenarioComparisonFactorsSchema.safeParse({
    ...factors,
    maaSchedules: maaSchedules.length > 0 || factors.includeRotation === true
      ? maaSchedules
      : [...DEFAULT_FACTORS.maaSchedules],
  })
  return parsed.success ? parsed.data : null
}

function clearInvalidSession(profileId: string): null {
  try {
    window.sessionStorage.removeItem(sessionKey(profileId))
  } catch {
    // Invalid best-effort storage can be ignored after falling back to defaults.
  }
  return null
}

async function settleInventory(
  onSettled: (() => void | Promise<void>) | undefined,
  setError: (message: string | null) => void,
): Promise<void> {
  try {
    await onSettled?.()
  } catch {
    setError(copy.inventory.refresh_failed)
  }
}

function writeSession(profileId: string, value: StoredScenarioSession): void {
  try {
    window.sessionStorage.setItem(sessionKey(profileId), JSON.stringify(value))
  } catch {
    // Session persistence is best-effort; the in-memory result remains usable.
  }
}
