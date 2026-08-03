import { processInventoryCampaignBatch } from './storage/admin-inventory-store'
import { createBackgroundWorker } from './background-worker-runtime'

const CAMPAIGN_INTERVAL_MS = 2_000
const controller = createBackgroundWorker({
  name: 'inventory_campaign',
  intervalMs: CAMPAIGN_INTERVAL_MS,
  idleIntervalMs: 10_000,
  run: async () => {
    return processInventoryCampaignBatch(100)
  },
})

export async function initializeInventoryCampaignWorker(): Promise<void> {
  await controller.initialize()
}

export function shutdownInventoryCampaignWorker(): void {
  controller.stop()
}

export function waitForInventoryCampaignWorkerIdle(): Promise<void> {
  return controller.waitForIdle()
}
