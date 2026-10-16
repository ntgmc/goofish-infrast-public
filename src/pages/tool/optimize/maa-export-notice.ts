import { copy } from '../../../copy'
import { normalizeScheduleMode } from '../../../lib/config'
import type { SystemItemCode } from '../../../lib/inventory-contracts'

export function getMaaExportNotice(scheduleMode: unknown, enabled: boolean, account?: {
  userCanExportMaaWithoutCoupon: boolean
  itemBalances: Partial<Record<SystemItemCode, number>>
  inventoryLoaded: boolean
  inventoryError: string | null
}) {
  const text = copy.optimize.maa_export
  if (!enabled) return text.disabled
  if (normalizeScheduleMode(scheduleMode) === 'rotation') return text.rotation
  if (!account) return text.free
  if (account.userCanExportMaaWithoutCoupon) return text.direct
  if (account.inventoryError) return text.failed
  if (!account.inventoryLoaded) return text.checking
  if ((account.itemBalances.maa_export_trial_coupon ?? 0) > 0) return text.coupon
  return text.free
}
