import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { CreateOptimizationJobRequest } from '../../../lib/optimization-contracts'
import { getOptimizePollRetryDelayMs } from '../../../lib/optimize-poll'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse, OptimizeResult } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { buildOptimizeJobStorageKey, clearActiveOptimizeJob, fetchOptimizeJobStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, mergeOptimizeJobProgress, OptimizeJobPollCancelledError, prepareOptimizeContinuationProgress, readActiveOptimizeJob, waitForOptimizePoll, writeActiveOptimizeJob } from './job-progress'
import { submitOptimizationJob } from './optimization-api'

interface UseOptimizationJobOptions {
  profileId: string;
  orderHash: string;
  signature: string;
  progressRef: MutableRefObject<ScheduleProgressState | null>;
  setProgress: Dispatch<SetStateAction<ScheduleProgressState | null>>;
}

export function useOptimizationJob({
  profileId,
  orderHash,
  signature,
  progressRef,
  setProgress,
}: UseOptimizationJobOptions) {
  const pollOptimizationJob = useCallback(async (
    job: OptimizeJobAccepted | OptimizeJobStatusResponse,
    storageKey: string,
    progressMode: ScheduleProgressState['mode'],
    fallbackMessage: string,
    isCancelled?: () => boolean,
    continueProgress = false,
  ): Promise<OptimizeResult> => {
    const throwIfCancelled = () => {
      if (isCancelled?.()) throw new OptimizeJobPollCancelledError()
    }
    let latestJob = job
    const updateProgress = (
      next: OptimizeJobAccepted | OptimizeJobStatusResponse,
      connection?: Pick<ScheduleProgressState, 'connectionStatus' | 'consecutivePollFailures'>,
    ) => {
      const stored = readActiveOptimizeJob(storageKey)
      const storedProgress = stored?.job.job_id === next.job_id ? stored.progress : null
      const currentProgress = progressRef.current ?? storedProgress
      const isContinuationStart = Boolean(continueProgress && currentProgress && currentProgress.jobId !== next.job_id)
      const progressSeed = continueProgress
        ? prepareOptimizeContinuationProgress(currentProgress, next, Date.now())
        : currentProgress
      const nextProgress = {
        ...mergeOptimizeJobProgress(progressSeed, next, progressMode, Date.now()),
        ...(isContinuationStart && { estimateAdjustment: '排班已完成，正在整理练度建议' }),
        connectionStatus: connection?.connectionStatus ?? 'connected',
        consecutivePollFailures: connection?.consecutivePollFailures ?? 0,
        lastSuccessfulSyncAt: connection?.connectionStatus === 'reconnecting'
          ? progressRef.current?.lastSuccessfulSyncAt ?? storedProgress?.lastSuccessfulSyncAt
          : Date.now(),
      } satisfies ScheduleProgressState
      progressRef.current = nextProgress
      setProgress(nextProgress)
      writeActiveOptimizeJob(storageKey, next, nextProgress)
      return nextProgress
    }

    const initialStoredProgress = readActiveOptimizeJob(storageKey)?.progress
    const initialFailures = initialStoredProgress?.connectionStatus === 'reconnecting'
      ? Math.max(1, initialStoredProgress.consecutivePollFailures ?? 1)
      : 0
    updateProgress(job, initialFailures > 0
      ? { connectionStatus: 'reconnecting', consecutivePollFailures: initialFailures }
      : undefined)
    let consecutivePollFailures = initialFailures
    let pollAfterMs = job.poll_after_ms || (job.status === 'queued' ? 1200 : 900)

    while (true) {
      throwIfCancelled()
      await waitForOptimizePoll(pollAfterMs, isCancelled)
      throwIfCancelled()

      let status: OptimizeJobStatusResponse
      try {
        status = await fetchOptimizeJobStatus(job.job_id, fallbackMessage, isCancelled)
      } catch (error) {
        throwIfCancelled()
        if (!isRetryableOptimizePollError(error)) throw error
        consecutivePollFailures += 1
        updateProgress(latestJob, { connectionStatus: 'reconnecting', consecutivePollFailures })
        pollAfterMs = getOptimizePollRetryDelayMs(consecutivePollFailures)
        continue
      }

      latestJob = status
      consecutivePollFailures = 0
      if (status.status === 'succeeded') {
        if (!status.result) throw new Error('优化任务缺少结果。')
        clearActiveOptimizeJob(storageKey)
        return status.result
      }
      if (status.status === 'failed') {
        clearActiveOptimizeJob(storageKey)
        throw new Error(status.error || '优化任务失败，请重试。')
      }
      updateProgress(status)
      pollAfterMs = status.poll_after_ms || (status.status === 'queued' ? 1200 : 900)
    }
  }, [progressRef, setProgress])

  const runOptimizationJob = useCallback(async (
    payload: CreateOptimizationJobRequest,
    progressMode: ScheduleProgressState['mode'],
    fallbackMessage: string,
    continueProgress = false,
  ): Promise<OptimizeResult> => {
    const accepted = await submitOptimizationJob(payload, fallbackMessage)
    const storageKey = buildOptimizeJobStorageKey(profileId, orderHash, signature, progressMode)
    try {
      return await pollOptimizationJob(accepted, storageKey, progressMode, fallbackMessage, undefined, continueProgress)
    } catch (error) {
      if (!isOptimizeJobPollCancelled(error)) clearActiveOptimizeJob(storageKey)
      throw error
    }
  }, [orderHash, pollOptimizationJob, profileId, signature])

  return { pollOptimizationJob, runOptimizationJob }
}
