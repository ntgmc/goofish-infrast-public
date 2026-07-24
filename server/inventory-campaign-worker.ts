import { processInventoryCampaignBatch } from './storage/admin-inventory-store'

const CAMPAIGN_INTERVAL_MS = 2_000
let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function initializeInventoryCampaignWorker(): Promise<void> {
  if (timer) return
  await runBatch()
  timer = setInterval(() => void runBatch(), CAMPAIGN_INTERVAL_MS)
  timer.unref?.()
}

export function shutdownInventoryCampaignWorker(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function runBatch(): Promise<void> {
  if (running) return
  running = true
  try {
    await processInventoryCampaignBatch(100)
  } catch (error) {
    console.warn('inventory campaign batch skipped:', error)
  } finally {
    running = false
  }
}
