import type {
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  OptimizeEstimateBucket,
  OptimizeEstimateSource,
  OptimizeJobPriority,
  OptimizeResult,
  ReorderCheckResult,
  UpgradeTaskPayload,
} from './types'
import type { ScenarioComparisonFactors, ScenarioComparisonResult } from './scenario-comparison'

export type OptimizationIdentity =
  | { type: 'profile'; profileId: string }
  | { type: 'license'; license: LicenseFile; activationToken?: string }

interface OptimizationJobInput {
  identity: OptimizationIdentity;
  operators: LicenseOperator[];
  config: LicenseConfig;
}

export type CreateOptimizationJobRequest =
  | (OptimizationJobInput & {
      kind: 'schedule';
      ignoreElite: boolean;
      includeCurrent?: boolean;
      historySource?: 'generated' | 'applied_suggestions';
    })
  | (OptimizationJobInput & {
      kind: 'upgrade_suggestions';
      upgradeTaskPayload: UpgradeTaskPayload;
    })
  | (Omit<OptimizationJobInput, 'identity'> & {
      kind: 'scenario_comparison';
      identity: Extract<OptimizationIdentity, { type: 'profile' }>;
      factors: ScenarioComparisonFactors;
    })

export interface CreateReorderCheckRequest {
  profileId: string;
  config: LicenseConfig;
  baselineHistoryId: string;
}

export interface ApiContractError {
  code: string;
  message: string;
  details?: unknown;
}

export interface OptimizationPrioritySnapshot {
  kind: OptimizeJobPriority;
  label: string;
}

export interface OptimizationTimestamps {
  submittedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export type OptimizationEstimatePhase = 'queued' | 'running' | 'overdue' | 'completed' | 'failed'

export interface OptimizationEstimateSnapshot {
  durationMs: number;
  bucket: OptimizeEstimateBucket;
  source: OptimizeEstimateSource;
  sampleCount: number;
  remainingMs: number | null;
  totalMs: number | null;
  phase: OptimizationEstimatePhase;
  updatedAt: string;
}

interface OptimizationJobSnapshotBase {
  id: string;
  priority: OptimizationPrioritySnapshot;
  queuePosition: number | null;
  pollAfterMs: number;
  timestamps: OptimizationTimestamps;
  estimate: OptimizationEstimateSnapshot;
}

export type OptimizationJobSnapshot<TResult = OptimizeResult> =
  | (OptimizationJobSnapshotBase & { status: 'queued' })
  | (OptimizationJobSnapshotBase & { status: 'running' })
  | (OptimizationJobSnapshotBase & { status: 'succeeded'; result: TResult })
  | (OptimizationJobSnapshotBase & { status: 'failed'; error: ApiContractError })

export interface CreateOptimizationJobResponse<TResult = OptimizeResult> {
  job: OptimizationJobSnapshot<TResult>;
}

export type ScenarioComparisonJobSnapshot = OptimizationJobSnapshot<ScenarioComparisonResult>
export type CreateScenarioComparisonJobResponse = CreateOptimizationJobResponse<ScenarioComparisonResult>

export interface ReorderCheckResponse {
  result: ReorderCheckResult;
}

export function isOptimizationJobTerminal(
  job: OptimizationJobSnapshot,
): job is Extract<OptimizationJobSnapshot, { status: 'succeeded' | 'failed' }> {
  return job.status === 'succeeded' || job.status === 'failed'
}

export function isOptimizationJobActive(
  job: OptimizationJobSnapshot,
): job is Extract<OptimizationJobSnapshot, { status: 'queued' | 'running' }> {
  return job.status === 'queued' || job.status === 'running'
}
