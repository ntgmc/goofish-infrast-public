import { resendEmailVerificationForUserId } from './handlers/user-auth'
import { processAdminInvitationVerificationOutboxBatch } from './storage/admin-registration-invitation-store'
import { processInvitationSettlementBatch } from './storage/invitation-store'
import { createBackgroundWorker } from './background-worker-runtime'

const SETTLEMENT_INTERVAL_MS = 2_000
const controller = createBackgroundWorker({
  name: 'invitation_settlement',
  intervalMs: SETTLEMENT_INTERVAL_MS,
  idleIntervalMs: 10_000,
  run: async () => {
    const results = await Promise.allSettled([
      processInvitationSettlementBatch(100),
      processAdminInvitationVerificationOutboxBatch(resendEmailVerificationForUserId, 20),
    ])
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} invitation worker subtasks failed`)
    }
    return results.reduce(
      (processed, result) => processed + (result.status === 'fulfilled' ? Number(result.value) || 0 : 0),
      0,
    )
  },
})

export async function initializeInvitationSettlementWorker(): Promise<void> {
  await controller.initialize()
}

export function shutdownInvitationSettlementWorker(): void {
  controller.stop()
}

export function waitForInvitationSettlementWorkerIdle(): Promise<void> {
  return controller.waitForIdle()
}
