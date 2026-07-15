import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleProgressState } from '../../../../components/ScheduleProgress'
import { apiJson } from '../../../../lib/api-client'
import type {
  CreateOptimizationJobRequest,
  CreateScenarioComparisonJobResponse,
  ScenarioComparisonJobSnapshot,
} from '../../../../lib/optimization-contracts'
import type { ScenarioComparisonFactors, ScenarioComparisonResult } from '../../../../lib/scenario-comparison'
import type { LicenseConfig, LicenseOperator } from '../../../../lib/types'
import { copy } from '../../../../copy/index'


const DEFAULT_FACTORS: ScenarioComparisonFactors = {
  layouts: [{
    layout: '243',
    plans: [{
      trading: { lmd: 2, orundum: 0 },
      manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 },
    }],
  }],
  maaSchedules: ['variable', '8x3', '12x2'],
  includeRotation: true,
  droneStrategies: ['off', 'auto'],
}

interface StoredScenarioSession {
  factors: ScenarioComparisonFactors;
  activeJobId?: string;
  result?: ScenarioComparisonResult;
}

export function useScenarioComparison({
  profileId,
  operators,
  config,
}: {
  profileId: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
}) {
  const initial = useMemo(() => readSession(profileId), [profileId])
  const [factors, setFactorsState] = useState<ScenarioComparisonFactors>(initial?.factors ?? DEFAULT_FACTORS)
  const [result, setResult] = useState<ScenarioComparisonResult | null>(initial?.result ?? null)
  const [job, setJob] = useState<ScenarioComparisonJobSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(initial?.activeJobId))
  const pollRunRef = useRef(0)
  const previousProfileIdRef = useRef(profileId)

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
    while (pollRunRef.current === runId) {
      try {
        const snapshot = await apiJson<ScenarioComparisonJobSnapshot>(
          `/api/optimization/jobs/${encodeURIComponent(jobId)}`,
          { fallbackMessage: copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_001 },
        )
        if (pollRunRef.current !== runId) return
        failures = 0
        setJob(snapshot)
        if (snapshot.status === 'succeeded') {
          setResult(snapshot.result)
          setLoading(false)
          writeSession(profileId, { factors: sessionFactors, result: snapshot.result })
          return
        }
        if (snapshot.status === 'failed') {
          setError(snapshot.error.message)
          setLoading(false)
          writeSession(profileId, { factors: sessionFactors })
          return
        }
        await delay(snapshot.pollAfterMs || (snapshot.status === 'queued' ? 1200 : 900))
      } catch (caught) {
        failures += 1
        if (failures >= 6) {
          setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_002)
          setLoading(false)
          return
        }
        await delay(Math.min(8_000, 800 * 2 ** failures))
      }
    }
  }, [profileId])
  const pollJobRef = useRef(pollJob)

  useEffect(() => {
    pollJobRef.current = pollJob
  }, [pollJob])

  const run = useCallback(async () => {
    setError(null)
    setLoading(true)
    setResult(null)
    const request: CreateOptimizationJobRequest = {
      kind: 'scenario_comparison',
      identity: { type: 'profile', profileId },
      operators,
      config,
      factors,
    }
    try {
      const response = await apiJson<CreateScenarioComparisonJobResponse>('/api/optimization/jobs', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        json: request,
        fallbackMessage: copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_003,
      })
      const nextJob = response.job
      setJob(nextJob)
      writeSession(profileId, { factors, activeJobId: nextJob.id })
      pollRunRef.current += 1
      await pollJob(nextJob.id, pollRunRef.current, factors)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_scenario_lab_useScenarioComparison_004)
      setLoading(false)
      writeSession(profileId, { factors })
    }
  }, [config, factors, operators, pollJob, profileId])

  useEffect(() => {
    const previousProfileId = previousProfileIdRef.current
    if (previousProfileId !== profileId) removeSession(previousProfileId)
    previousProfileIdRef.current = profileId
    const restored = readSession(profileId)
    const restoredFactors = restored?.factors ?? DEFAULT_FACTORS
    setFactorsState(restoredFactors)
    setResult(restored?.result ?? null)
    setError(null)
    setJob(null)
    setLoading(Boolean(restored?.activeJobId))
    pollRunRef.current += 1
    const runId = pollRunRef.current
    if (restored?.activeJobId) void pollJobRef.current(restored.activeJobId, runId, restoredFactors)
    return () => {
      if (pollRunRef.current === runId) pollRunRef.current += 1
    }
  }, [profileId])

  const progress = useMemo<ScheduleProgressState | null>(() => job && loading ? {
    mode: 'scenario',
    startedAt: Date.parse(job.timestamps.submittedAt),
    queueStatus: job.status === 'queued' ? 'queued' : 'running',
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
    connectionStatus: 'connected',
  } : null, [job, loading])

  return { factors, setFactors, result, error, loading, progress, run }
}

function sessionKey(profileId: string): string {
  return `maa:scenario-lab:v2:${profileId}`
}

function readSession(profileId: string): StoredScenarioSession | null {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(profileId))
    return raw ? JSON.parse(raw) as StoredScenarioSession : null
  } catch {
    return null
  }
}

function writeSession(profileId: string, value: StoredScenarioSession): void {
  try {
    window.sessionStorage.setItem(sessionKey(profileId), JSON.stringify(value))
  } catch {
    // Session persistence is best-effort; the in-memory result remains usable.
  }
}

function removeSession(profileId: string): void {
  try {
    window.sessionStorage.removeItem(sessionKey(profileId))
  } catch {
    // Session persistence is best-effort; switching profiles still resets React state.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
