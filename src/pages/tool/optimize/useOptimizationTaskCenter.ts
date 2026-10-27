import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
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
  refreshing: boolean;
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
  userId: string,
  profileId: string,
  dialogOpen: boolean,
): OptimizationTaskCenterController {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [notificationsEnabled, setNotificationsEnabledState] = useState(optimizationNotificationsEnabled)
  const refreshTimerRef = useRef<number | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['user', userId, profileId, 'optimization-jobs'],
    queryFn: ({ pageParam, signal }) => listOptimizationJobs(profileId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(userId && profileId),
    refetchOnWindowFocus: 'always',
    refetchInterval: (current) => dialogOpen || current.state.data?.pages.some((page) =>
      page.jobs.some((job) => job.status === 'queued' || job.status === 'running')) ? 10_000 : 30_000,
  })
  const { refetch, fetchNextPage, hasNextPage, isFetching } = query
  const jobs = useMemo(() => dedupeJobs(query.data?.pages.flatMap((page) => page.jobs) ?? []), [query.data])
  const activeCount = useMemo(
    () => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    [jobs],
  )
  const attentionCount = useMemo(
    () => jobs.filter((job) => job.status === 'failed' || job.status === 'dead_lettered').length,
    [jobs],
  )
  const refresh = useCallback(async () => {
    setError(null)
    await refetch({ cancelRefetch: false })
  }, [refetch])
  const loadMore = useCallback(async () => {
    if (hasNextPage && !isFetching) await fetchNextPage({ cancelRefetch: false })
  }, [fetchNextPage, hasNextPage, isFetching])

  useEffect(() => {
    setNotice(null)
    setError(null)
    setBusyJobId(null)
    return subscribeOptimizationJobUpdates((event) => {
      if (event.profileId !== profileId || document.visibilityState === 'hidden' || refreshTimerRef.current !== null) return
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        if (document.visibilityState !== 'hidden') void refresh()
      }, 250)
    })
  }, [profileId, refresh, userId])

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = null
  }, [profileId, userId])

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
      await queryClient.invalidateQueries({ queryKey: ['user', userId, profileId, 'optimization-jobs'] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_029)
    } finally {
      setBusyJobId(null)
    }
  }, [profileId, queryClient, userId])

  const toggleNotifications = useCallback(async () => {
    const enabled = await setOptimizationNotificationsEnabled(!notificationsEnabled)
    setNotificationsEnabledState(enabled ? !notificationsEnabled : false)
    if (!enabled && !notificationsEnabled) setNotice(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_008)
  }, [notificationsEnabled])

  return {
    jobs,
    activeCount,
    attentionCount,
    loading: query.isLoading,
    refreshing: query.isRefetching && !query.isFetchingNextPage,
    loadingMore: query.isFetchingNextPage,
    error: error ?? (query.error ? query.error instanceof Error ? query.error.message : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_028 : null),
    notice,
    busyJobId,
    notificationsEnabled,
    hasMore: hasNextPage,
    refresh,
    loadMore,
    cancel,
    toggleNotifications,
  }
}

function dedupeJobs(jobs: OptimizationJobListItem[]): OptimizationJobListItem[] {
  const seen = new Set<string>()
  return jobs.filter((job) => {
    if (seen.has(job.id)) return false
    seen.add(job.id)
    return true
  })
}
