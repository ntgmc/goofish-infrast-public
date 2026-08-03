import { afterEach, describe, expect, it, vi } from 'vitest'

const processInventoryCampaignBatch = vi.hoisted(() => vi.fn())
vi.mock('./storage/admin-inventory-store', () => ({ processInventoryCampaignBatch }))

import {
  initializeInventoryCampaignWorker,
  shutdownInventoryCampaignWorker,
  waitForInventoryCampaignWorkerIdle,
} from './inventory-campaign-worker'

afterEach(async () => {
  shutdownInventoryCampaignWorker()
  await waitForInventoryCampaignWorkerIdle()
  processInventoryCampaignBatch.mockReset()
})

describe('inventory campaign worker lifecycle', () => {
  it('blocks initialization when the first batch fails', async () => {
    processInventoryCampaignBatch.mockRejectedValueOnce(new Error('inventory unavailable'))

    await expect(initializeInventoryCampaignWorker()).rejects.toThrow('inventory unavailable')
  })
})
