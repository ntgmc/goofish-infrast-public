import {
  initializeBehaviorRiskMaintenance,
  shutdownBehaviorRiskMaintenance,
  waitForBehaviorRiskMaintenanceIdle,
} from './behavior-risk-maintenance'
import {
  initializeInventoryCampaignWorker,
  shutdownInventoryCampaignWorker,
  waitForInventoryCampaignWorkerIdle,
} from './inventory-campaign-worker'
import {
  initializeInvitationSettlementWorker,
  shutdownInvitationSettlementWorker,
  waitForInvitationSettlementWorkerIdle,
} from './invitation-settlement-worker'
import {
  initializeOptimizeQueueMaintenance,
  shutdownOptimizeQueueMaintenance,
  waitForOptimizeQueueMaintenanceIdle,
} from './optimize-queue-maintenance'

export const REQUIRED_WORKER_RESPONSIBILITIES = [
  'optimize_queue',
  'inventory_campaign',
  'invitation_settlement',
  'behavior_risk',
  'worker_registration',
] as const

export type WorkerLifecycleStage = {
  name: string
  initialize: () => Promise<void>
  stop: () => void
  waitForIdle: () => Promise<void>
}

const stages: readonly WorkerLifecycleStage[] = [
  {
    name: 'optimize queue maintenance',
    initialize: initializeOptimizeQueueMaintenance,
    stop: shutdownOptimizeQueueMaintenance,
    waitForIdle: waitForOptimizeQueueMaintenanceIdle,
  },
  {
    name: 'inventory campaign worker',
    initialize: initializeInventoryCampaignWorker,
    stop: shutdownInventoryCampaignWorker,
    waitForIdle: waitForInventoryCampaignWorkerIdle,
  },
  {
    name: 'invitation settlement worker',
    initialize: initializeInvitationSettlementWorker,
    stop: shutdownInvitationSettlementWorker,
    waitForIdle: waitForInvitationSettlementWorkerIdle,
  },
  {
    name: 'behavior risk maintenance',
    initialize: initializeBehaviorRiskMaintenance,
    stop: shutdownBehaviorRiskMaintenance,
    waitForIdle: waitForBehaviorRiskMaintenanceIdle,
  },
]

export async function initializeWorkerLifecycleStages(
  lifecycleStages: readonly Pick<WorkerLifecycleStage, 'initialize'>[] = stages,
): Promise<void> {
  await Promise.all(lifecycleStages.map((stage) => stage.initialize()))
}

export function stopWorkerLifecycleStages(): void {
  for (const stage of [...stages].reverse()) stage.stop()
}

export async function waitForWorkerLifecycleStagesIdle(): Promise<void> {
  await Promise.all(stages.map((stage) => stage.waitForIdle()))
}
