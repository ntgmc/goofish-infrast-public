import { recordUsageEvent } from '../../handlers/usage-stats'
import type { UsageReasonCode } from '../../storage/usage-store'

export async function recordReorderCheckEvent(
  status: 'success' | 'failure',
  reasonCode: UsageReasonCode,
  startedAt: number,
  profileId?: string,
  idempotencyKey?: string,
): Promise<void> {
  try {
    await recordUsageEvent('reorder_check', {
      status,
      reason_code: reasonCode,
      duration_ms: Date.now() - startedAt,
      permission: 'free_preview',
      profile_id: profileId,
      source: 'free_preview',
    }, idempotencyKey)
  } catch (error) {
    console.warn('变化影响预判使用统计记录已跳过:', error)
  }
}

export async function applyReorderCheckSuccessEffect(
  profileId: string,
  submittedAt: number,
  jobId: string,
): Promise<void> {
  await recordUsageEvent('reorder_check', {
    status: 'success',
    reason_code: 'ok',
    duration_ms: Math.max(0, Date.now() - submittedAt),
    permission: 'free_preview',
    profile_id: profileId,
    source: 'free_preview',
  }, `optimize-job/${jobId}/reorder-check`)
}
