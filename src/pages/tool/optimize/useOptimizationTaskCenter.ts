import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OptimizationJobListItem } from '../../../lib/optimization-contracts'
import { copy } from '../../../copy/index'
import { cancelOptimizationJob, listOptimizationJobs } from './optimization-api'
import {
  optimizationNotificationsEnabled,
  publishOptimizationJobUpdate,
  setOptimizationAppBadge,
  setOptimizationNotificationsEnabled,
  subscribeOptimizationJobUpdates,
} from './optimization-job-events'

export interface OptimizationTaskCenterController {
  jobs: OptimizationJobListItem[];
  activeCount: number;
  attentionCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  notice: string | null;
  busyJobId: string | null;
  notificationsEnabled: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  cancel: (job: OptimizationJobListItem) => Promise<void>;
  toggleNotifications: () => Promise<void>;
}

export function useOptimizationTaskCenter(
  profileId: string,
  dialogOpen: boolean,
): OptimizationTaskCenterController {
  const [jobs, setJobs] = useState<OptimizationJobListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [notificationsEnabled, setNotificationsEnabledState] = useState(optimizationNotificationsEnabled)
  const requestSequenceRef = useRef(0)

  const activeCount = useMemo(
    () => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    [jobs],
  )
  const attentionCount = useMemo(
    () => jobs.filter((job) => job.status === 'failed' || job.status === 'dead_lettered').length,
    [jobs],
  )

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    const requestSequence = ++requestSequenceRef.current
    append ? setLoadingMore(true) : setLoading(true)
    try {
      const response = await listOptimizationJobs(profileId, cursor ?? undefined)
      if (requestSequence !== requestSequenceRef.current) return
      setJobs((current) => append ? dedupeJobs([...current, ...response.jobs]) : response.jobs)
      setNextCursor(response.nextCursor)
      setError(null)
    } catch (caught) {
      if (requestSequence !== requestSequenceRef.current) return
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_028)
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        append ? setLoadingMore(false) : setLoading(false)
      }
    }
  }, [profileId])

  const refresh = useCallback(async () => load(), [load])
  const loadMore = useCallback(async () => {
    if (nextCursor) await load(nextCursor, true)
  }, [load, nextCursor])

  useEffect(() => {
    requestSequenceRef.current += 1
    setJobs([])
    setNextCursor(null)
    setNotice(null)
    void load()
  }, [load, profileId])

  useEffect(() => subscribeOptimizationJobUpdates((event) => {
    if (event.profileId === profileId) void load()
  }), [load, profileId])

  useEffect(() => {
    const intervalMs = dialogOpen || activeCount > 0 ? 10_000 : 30_000
    const timer = window.setInterval(() => void load(), intervalMs)
    return () => window.clearInterval(timer)
  }, [activeCount, dialogOpen, load])

  useEffect(() => {
    setOptimizationAppBadge(activeCount)
    return () => setOptimizationAppBadge(0)
  }, [activeCount])

  const cancel = useCallback(async (job: OptimizationJobListItem) => {
    if (!window.confirm(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_031)) return
    setBusyJobId(job.id)
    setNotice(null)
    try {
      const snapshot = await cancelOptimizationJob(job.id)
      publishOptimizationJobUpdate(profileId, snapshot)
      setNotice(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_021)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_029)
    } finally {
      setBusyJobId(null)
    }
  }, [load, profileId])

  const toggleNotifications = useCallback(async () => {
    const enabled = await setOptimizationNotificationsEnabled(!notificationsEnabled)
    setNotificationsEnabledState(enabled ? !notificationsEnabled : false)
    if (!enabled && !notificationsEnabled) setNotice(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_008)
  }, [notificationsEnabled])

  return {
    jobs,
    activeCount,
    attentionCount,
    loading,
    loadingMore,
    error,
    notice,
    busyJobId,
    notificationsEnabled,
    hasMore: Boolean(nextCursor),
    refresh,
    loadMore,
    cancel,
    toggleNotifications,
  }
}

function dedupeJobs(jobs: OptimizationJobListItem[]): OptimizationJobListItem[] {
  const seen = new Set<string>()
  const unique: OptimizationJobListItem[] = []
  for (const job of jobs) {
    if (seen.has(job.id)) continue
    seen.add(job.id)
    unique.push(job)
  }
  return unique
}
