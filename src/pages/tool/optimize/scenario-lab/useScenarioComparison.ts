import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleProgressState } from '../../../../components/ScheduleProgress'
import { apiJson } from '../../../../lib/api-client'
import { getOptimizePollRetryDelayMs } from '../../../../lib/optimize-poll'
import type {
  CreateOptimizationJobRequest,
  CreateScenarioComparisonJobResponse,
  ScenarioComparisonJobSnapshot,
} from '../../../../lib/optimization-contracts'
import type { ScenarioComparisonFactors, ScenarioComparisonResult, ScenarioMaaSchedule } from '../../../../lib/scenario-comparison'
import type { LicenseConfig, LicenseOperator } from '../../../../lib/types'
import { copy } from '../../../../copy/index'
import { fetchOptimizeJobSnapshotStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, waitForOptimizePoll } from '../job-progress'
import { OPTIMIZE_SUBMIT_TIMEOUT_MS } from '../optimization-api'
import { publishOptimizationJobUpdate, subscribeOptimizationJobUpdates, withOptimizationSubmissionLock } from '../optimization-job-events'


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
            setLoading(false)
            writeSession(profileId, { factors: sessionFactors, result: snapshot.result })
            void onSettled?.()
            return
          }
          if (snapshot.status === 'failed' || snapshot.status === 'cancelled' || snapshot.status === 'dead_lettered') {
            if (snapshot.status === 'cancelled') {
              setError(null)
            } else {
              const supportSuffix = snapshot.error.supportReference ? ` (${snapshot.error.supportReference})` : ''
              setError(`${snapshot.error.message}${supportSuffix}`)
            }
            setLoading(false)
            writeSession(profileId, { factors: sessionFactors })
            void onSettled?.()
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
            setLoading(false)
            writeSession(profileId, { factors: sessionFactors })
            void onSettled?.()
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

  const run = useCallback(async (useCoupon = false) => {
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
      setLoading(false)
      writeSession(profileId, { factors, pendingSubmission })
      void onSettled?.()
    }
  }, [config, factors, onSettled, operators, pollJob, profileId])

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

  return { factors, setFactors, result, error, loading, progress, run }
}

function sessionKey(profileId: string): string {
  return `maa:scenario-lab:v2:${profileId}`
}

function readSession(profileId: string): StoredScenarioSession | null {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(profileId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredScenarioSession
    if (!parsed?.factors) return null
    return { ...parsed, factors: normalizeStoredFactors(parsed.factors) }
  } catch {
    return null
  }
}

function normalizeStoredFactors(factors: ScenarioComparisonFactors): ScenarioComparisonFactors {
  const maaSchedules = Array.isArray(factors.maaSchedules)
    ? factors.maaSchedules.filter((value): value is ScenarioMaaSchedule => value === 'variable' || value === '8x3')
    : [...DEFAULT_FACTORS.maaSchedules]
  return {
    ...factors,
    maaSchedules: maaSchedules.length > 0 || factors.includeRotation
      ? maaSchedules
      : [...DEFAULT_FACTORS.maaSchedules],
  }
}

function writeSession(profileId: string, value: StoredScenarioSession): void {
  try {
    window.sessionStorage.setItem(sessionKey(profileId), JSON.stringify(value))
  } catch {
    // Session persistence is best-effort; the in-memory result remains usable.
  }
}
