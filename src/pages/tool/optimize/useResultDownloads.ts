import { useCallback, useEffect, useRef } from 'react'
import { copy } from '../../../copy/index'
import { getOrCreateExportIdempotencyKey, requestFullResultExport, requestMaaExport } from './optimization-api'

interface UseResultDownloadsOptions {
  profileId: string
  guardExport: (run: () => void | Promise<void>) => Promise<void>
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
  const requestKeysRef = useRef(new Map<string, string>())
  const exportInFlightRef = useRef(false)

  useEffect(() => {
    requestKeysRef.current.clear()
    exportInFlightRef.current = false
  }, [profileId])

  const downloadMaaResult = useCallback(async (resultId: string) => {
    await guardExport(async () => {
      if (exportInFlightRef.current) return
      const useCoupon = !canExportMaaWithoutCoupon
      if (useCoupon && maaExportCouponBalance < 1) {
        setWorkspaceError(copy.inventory.maa_export_coupon_unavailable)
        return
      }
      if (useCoupon && !window.confirm(copy.inventory.maa_export_coupon_confirm(maaExportCouponBalance))) return

      const requestKey = `maa:${profileId}:${resultId}`
      const idempotencyKey = getOrCreateExportIdempotencyKey(requestKeysRef.current, requestKey)
      exportInFlightRef.current = true
      setWorkspaceBusyAction(`download:${resultId}`)
      setWorkspaceError(null)
      try {
        const response = await requestMaaExport(profileId, resultId, { idempotencyKey, useCoupon })
        requestKeysRef.current.delete(requestKey)
        if (response.consumed_coupon) {
          setWorkspaceNotice(copy.inventory.maa_export_coupon_consumed)
          await refreshInventory()
        }
      } catch (error) {
        setWorkspaceError((error as Error).message)
      } finally {
        exportInFlightRef.current = false
        setWorkspaceBusyAction(null)
      }
    })
  }, [canExportMaaWithoutCoupon, guardExport, maaExportCouponBalance, profileId, refreshInventory, setWorkspaceBusyAction, setWorkspaceError, setWorkspaceNotice])

  const downloadFullResult = useCallback(async (resultId: string) => {
    await guardExport(async () => {
      if (exportInFlightRef.current) return
      const requestKey = `full:${profileId}:${resultId}`
      const idempotencyKey = getOrCreateExportIdempotencyKey(requestKeysRef.current, requestKey)
      exportInFlightRef.current = true
      setWorkspaceBusyAction(`download-full:${resultId}`)
      setWorkspaceError(null)
      try {
        await requestFullResultExport(profileId, resultId, idempotencyKey)
        requestKeysRef.current.delete(requestKey)
      } catch (error) {
        setWorkspaceError((error as Error).message)
      } finally {
        exportInFlightRef.current = false
        setWorkspaceBusyAction(null)
      }
    })
  }, [guardExport, profileId, setWorkspaceBusyAction, setWorkspaceError])

  return { downloadMaaResult, downloadFullResult }
}
