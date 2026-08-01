import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { copy } from '../../../copy/index'
import type { FreeScheduleEntitlement, ReorderCheckResult } from '../../../lib/types'
import { isOptimizeJobPollCancelled } from './job-progress'
import { cancelCurrentReorderCheckJob, resumeReorderCheckJob } from './reorder-job-progress'

interface ReorderRecoverySetters {
  setLoading: Dispatch<SetStateAction<boolean>>
  setResult: Dispatch<SetStateAction<ReorderCheckResult | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setEntitlement: Dispatch<SetStateAction<FreeScheduleEntitlement | null>>
}

export function useReorderJobRecovery(
  profileId: string,
  enabled: boolean,
  refreshInventory: () => Promise<void>,
  setters: ReorderRecoverySetters,
  onOpenResult: () => void,
): {
  isCancelled: () => boolean
  cancel: () => Promise<void>
  openResult: (result: ReorderCheckResult) => void
} {
  const mountedRef = useRef(true)
  const activeProfileIdRef = useRef(profileId)
  const settersRef = useRef(setters)
  activeProfileIdRef.current = profileId
  settersRef.current = setters

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isCancelled = useCallback(
    () => !mountedRef.current || activeProfileIdRef.current !== profileId,
    [profileId],
  )

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const state = settersRef.current
    state.setLoading(true)
    void resumeReorderCheckJob(
      profileId,
      copy.optimize.pages_tool_optimize_useOptimizeWorkflow_015,
      () => cancelled || isCancelled(),
    ).then((data) => {
      if (!data || cancelled || isCancelled()) return
      state.setResult(data)
      state.setError(null)
      if (data.free_schedule_entitlement) state.setEntitlement(data.free_schedule_entitlement)
    }).catch((error) => {
      if (!cancelled && !isCancelled() && !isOptimizeJobPollCancelled(error)) {
        state.setError(error instanceof Error ? error.message : copy.optimize.pages_tool_optimize_useOptimizeWorkflow_015)
      }
    }).finally(() => {
      if (!cancelled && !isCancelled()) {
        state.setLoading(false)
        void refreshInventory()
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled, isCancelled, profileId, refreshInventory])

  const cancel = useCallback(async () => {
    if (!window.confirm(copy.optimize.pages_tool_optimize_OverviewSection_070)) return
    try {
      await cancelCurrentReorderCheckJob(profileId)
    } catch (error) {
      settersRef.current.setError(error instanceof Error
        ? error.message
        : copy.optimize.pages_tool_optimize_useOptimizeWorkflow_015)
    }
  }, [profileId])

  const openResult = useCallback((result: ReorderCheckResult) => {
    const state = settersRef.current
    state.setError(null)
    state.setResult(result)
    if (result.free_schedule_entitlement) state.setEntitlement(result.free_schedule_entitlement)
    onOpenResult()
  }, [onOpenResult])

  return { isCancelled, cancel, openResult }
}
