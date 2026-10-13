import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getApiErrorMessage } from '../../../lib/api-client'
import { copy } from '../../../copy/index'
import { getOrCreateExportIdempotencyKey, requestFullResultExport, requestMaaExport } from './optimization-api'
import { useSiteFeatures } from '../../../lib/site-feature-context'

export type ResultExportFailure = { resultId: string | undefined; format: 'maa' | 'full'; error: unknown }

interface UseResultDownloadsOptions {
  profileId: string
  guardExport: (run: () => void | Promise<void>, onError: (message: string) => void) => Promise<void>
  canExportMaaWithoutCoupon: boolean
  maaExportCouponBalance: number
  refreshInventory: () => void | Promise<void>
  setWorkspaceNotice: (message: string | null) => void
  setWorkspaceError: (message: string | null) => void
  setWorkspaceBusyAction: (action: string | null) => void
}

export function useResultDownloads({
  profileId,
  guardExport,
  canExportMaaWithoutCoupon,
  maaExportCouponBalance,
  refreshInventory,
  setWorkspaceNotice,
  setWorkspaceError,
  setWorkspaceBusyAction,
}: UseResultDownloadsOptions) {
  const { features } = useSiteFeatures()
  const requestKeysRef = useRef(new Map<string, string>())
  const exportInFlightRef = useRef(false)
  const [exportFailure, setExportFailure] = useState<ResultExportFailure | null>(null)
  const profileRef = useRef(profileId)
  profileRef.current = profileId

  useEffect(() => {
    requestKeysRef.current.clear()
    exportInFlightRef.current = false
    setExportFailure(null)
  }, [profileId])

  const failExport = useCallback((format: ResultExportFailure['format'], resultId: string | undefined, error: unknown) => {
    if (profileRef.current !== profileId) return
    setExportFailure({ format, resultId, error })
    setWorkspaceError(getApiErrorMessage(error, format === 'maa' ? copy.inventory.maa_export_failed : copy.inventory.full_result_export_failed))
  }, [profileId, setWorkspaceError])

  const downloadMaaResult = useCallback(async (resultId: string | undefined) => {
    const fail = (error: unknown) => failExport('maa', resultId, error)
    setExportFailure(null)
    setWorkspaceError(null)
    if (!resultId) {
      fail(new ApiError(copy.v2.exportMissingResult, 404, { code: 'result_not_found' }, '/api/user/maa-export'))
      return
    }
    if (!features.maa_export) {
      fail(new Error(copy.features.closed_body))
      return
    }
    await guardExport(async () => {
      if (profileRef.current !== profileId || exportInFlightRef.current) return
      const useCoupon = !canExportMaaWithoutCoupon
      const requestKey = `maa:${profileId}:${resultId}`
      const retrying = requestKeysRef.current.has(requestKey)
      if (useCoupon && maaExportCouponBalance < 1 && !retrying) {
        fail(new ApiError(copy.inventory.maa_export_coupon_unavailable, 403, { code: 'maa_export_coupon_required' }, '/api/user/maa-export'))
        return
      }
      if (useCoupon && !retrying && !window.confirm(copy.inventory.maa_export_coupon_confirm(maaExportCouponBalance))) return
      const idempotencyKey = getOrCreateExportIdempotencyKey(requestKeysRef.current, requestKey)
      exportInFlightRef.current = true
      setWorkspaceBusyAction(`download:${resultId}`)
      setWorkspaceError(null)
      try {
        const response = await requestMaaExport(profileId, resultId, { idempotencyKey, useCoupon })
        if (profileRef.current !== profileId) return
        requestKeysRef.current.delete(requestKey)
        if (response.consumed_coupon) {
          setWorkspaceNotice(copy.inventory.maa_export_coupon_consumed)
          try { await refreshInventory() }
          catch (error) { setWorkspaceError(getApiErrorMessage(error, copy.inventory.balances_load_failed)) }
        }
      } catch (error) {
        fail(error)
      } finally {
        if (profileRef.current === profileId) {
          exportInFlightRef.current = false
          setWorkspaceBusyAction(null)
        }
      }
    }, (message) => fail(new Error(message)))
  }, [failExport, features.maa_export, canExportMaaWithoutCoupon, guardExport, maaExportCouponBalance, profileId, refreshInventory, setWorkspaceBusyAction, setWorkspaceError, setWorkspaceNotice])

  const downloadFullResult = useCallback(async (resultId: string | undefined) => {
    const fail = (error: unknown) => failExport('full', resultId, error)
    setExportFailure(null)
    setWorkspaceError(null)
    if (!resultId) {
      fail(new ApiError(copy.v2.exportMissingResult, 404, { code: 'result_not_found' }, '/api/user/full-result-export'))
      return
    }
    if (!features.full_result_export) {
      fail(new Error(copy.features.closed_body))
      return
    }
    await guardExport(async () => {
      if (profileRef.current !== profileId || exportInFlightRef.current) return
      const requestKey = `full:${profileId}:${resultId}`
      const idempotencyKey = getOrCreateExportIdempotencyKey(requestKeysRef.current, requestKey)
      exportInFlightRef.current = true
      setWorkspaceBusyAction(`download-full:${resultId}`)
      setWorkspaceError(null)
      try {
        await requestFullResultExport(profileId, resultId, idempotencyKey)
        if (profileRef.current === profileId) requestKeysRef.current.delete(requestKey)
      } catch (error) {
        fail(error)
      } finally {
        if (profileRef.current === profileId) {
          exportInFlightRef.current = false
          setWorkspaceBusyAction(null)
        }
      }
    }, (message) => fail(new Error(message)))
  }, [failExport, features.full_result_export, guardExport, profileId, setWorkspaceBusyAction, setWorkspaceError])

  return { downloadMaaResult, downloadFullResult, exportFailure }
}
