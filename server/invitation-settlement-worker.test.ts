import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  processInvitationSettlementBatch,
  processAdminInvitationVerificationOutboxBatch,
} = vi.hoisted(() => ({
  processInvitationSettlementBatch: vi.fn(),
  processAdminInvitationVerificationOutboxBatch: vi.fn(),
}))

vi.mock('./handlers/user-auth', () => ({ resendEmailVerificationForUserId: vi.fn() }))
vi.mock('./storage/invitation-store', () => ({ processInvitationSettlementBatch }))
vi.mock('./storage/admin-registration-invitation-store', () => ({ processAdminInvitationVerificationOutboxBatch }))

import {
  initializeInvitationSettlementWorker,
  shutdownInvitationSettlementWorker,
  waitForInvitationSettlementWorkerIdle,
} from './invitation-settlement-worker'

afterEach(async () => {
  shutdownInvitationSettlementWorker()
  await waitForInvitationSettlementWorkerIdle()
  processInvitationSettlementBatch.mockReset()
  processAdminInvitationVerificationOutboxBatch.mockReset()
})

describe('invitation settlement worker lifecycle', () => {
  it('blocks initialization when either first-run subtask fails', async () => {
    processInvitationSettlementBatch.mockResolvedValue(undefined)
    processAdminInvitationVerificationOutboxBatch.mockRejectedValue(new Error('outbox unavailable'))

    await expect(initializeInvitationSettlementWorker()).rejects.toThrow('1 invitation worker subtasks failed')
  })
})
