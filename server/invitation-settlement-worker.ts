import { resendEmailVerificationForUserId } from './handlers/user-auth'
import { processAdminInvitationVerificationOutboxBatch } from './storage/admin-registration-invitation-store'
import { processInvitationSettlementBatch } from './storage/invitation-store'

const SETTLEMENT_INTERVAL_MS = 2_000
let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function initializeInvitationSettlementWorker(): Promise<void> {
  if (timer) return
  await runBatch()
  timer = setInterval(() => void runBatch(), SETTLEMENT_INTERVAL_MS)
  timer.unref?.()
}

export function shutdownInvitationSettlementWorker(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function runBatch(): Promise<void> {
  if (running) return
  running = true
  try {
    const results = await Promise.allSettled([
      processInvitationSettlementBatch(100),
      processAdminInvitationVerificationOutboxBatch(resendEmailVerificationForUserId, 20),
    ])
    for (const result of results) {
      if (result.status === 'rejected') console.warn('invitation worker subtask skipped:', result.reason)
    }
  } catch (error) {
    console.warn('invitation settlement batch skipped:', error)
  } finally {
    running = false
  }
}
