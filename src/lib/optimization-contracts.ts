import type {
  LicenseConfig,
  LicenseOperator,
  OptimizeEstimateBucket,
  OptimizeEstimateSource,
  OptimizeJobPriority,
  OptimizeResult,
  ReorderCheckResult,
} from './types'
import type { ScenarioComparisonFactors, ScenarioComparisonResult } from './scenario-comparison'

type OptimizationIdentity = { type: 'profile'; profileId: string }

interface OptimizationJobInput {
  identity: OptimizationIdentity;
  operators: LicenseOperator[];
  config: LicenseConfig;
}

export type CreateOptimizationJobRequest =
  | (OptimizationJobInput & {
      kind: 'schedule';
      includeUpgradeSuggestions: boolean;
      historySource?: 'generated' | 'applied_suggestions';
      use_priority_coupon?: boolean;
    })
  | (Omit<OptimizationJobInput, 'identity'> & {
      kind: 'scenario_comparison';
      identity: OptimizationIdentity;
      factors: ScenarioComparisonFactors;
    })

export interface CreateReorderCheckRequest {
  profileId: string;
  config: LicenseConfig;
  baselineHistoryId: string;
}

interface ApiContractError {
  code: string;
  message: string;
  details?: unknown;
}

interface OptimizationPrioritySnapshot {
  kind: OptimizeJobPriority;
  label: string;
}

interface OptimizationTimestamps {
  submittedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  nextAttemptAt?: string | null;
  cancelRequestedAt?: string | null;
}

type OptimizationEstimatePhase = 'queued' | 'running' | 'overdue' | 'completed' | 'failed' | 'cancelled'
export type OptimizationJobKind = CreateOptimizationJobRequest['kind']
type OptimizationExecutionPhase = 'initial_queue' | 'retry_wait' | 'executing' | 'settling' | 'terminal'
type OptimizationRecoveryAction = 'retry' | 'review_input' | 'reauthorize' | 'contact_support' | 'none'

export interface OptimizationFailureSnapshot extends ApiContractError {
  retryable: boolean;
  recoveryAction: OptimizationRecoveryAction;
  failureKind?: string;
  attemptCount: number;
  supportReference: string;
}

interface OptimizationEstimateSnapshot {
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
  kind: OptimizationJobKind;
  source: string;
  priority: OptimizationPrioritySnapshot;
  queuePosition: number | null;
  pollAfterMs: number;
  timestamps: OptimizationTimestamps;
  estimate: OptimizationEstimateSnapshot;
  executionPhase: OptimizationExecutionPhase;
  attemptCount: number;
  failureCount: number;
  cancellationRequested: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

export type OptimizationJobSnapshot<TResult = OptimizeResult> =
  | (OptimizationJobSnapshotBase & { status: 'queued' })
  | (OptimizationJobSnapshotBase & { status: 'running' })
  | (OptimizationJobSnapshotBase & { status: 'succeeded'; result: TResult })
  | (OptimizationJobSnapshotBase & { status: 'failed'; error: OptimizationFailureSnapshot })
  | (OptimizationJobSnapshotBase & { status: 'cancelled'; error: OptimizationFailureSnapshot })
  | (OptimizationJobSnapshotBase & { status: 'dead_lettered'; error: OptimizationFailureSnapshot })

export type OptimizationJobListItem = OptimizationJobSnapshotBase & (
  | { status: 'queued' | 'running'; resultAvailable: false }
  | { status: 'succeeded'; resultAvailable: true }
  | { status: 'failed' | 'cancelled' | 'dead_lettered'; resultAvailable: false; error: OptimizationFailureSnapshot }
)

export interface OptimizationJobListResponse {
  jobs: OptimizationJobListItem[];
  nextCursor: string | null;
}

export interface OptimizationJobMutationResponse<TResult = OptimizeResult> {
  job: OptimizationJobSnapshot<TResult>;
}

export interface CreateOptimizationJobResponse<TResult = OptimizeResult> {
  job: OptimizationJobSnapshot<TResult>;
  pollToken?: string;
}

export type ScenarioComparisonJobSnapshot = OptimizationJobSnapshot<ScenarioComparisonResult>
export type CreateScenarioComparisonJobResponse = CreateOptimizationJobResponse<ScenarioComparisonResult>

export interface ReorderCheckResponse {
  result: ReorderCheckResult;
}

export function isOptimizationJobTerminal(
  job: OptimizationJobSnapshot,
): job is Extract<OptimizationJobSnapshot, { status: 'succeeded' | 'failed' | 'cancelled' | 'dead_lettered' }> {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'dead_lettered'
}

export function isOptimizationJobActive(
  job: OptimizationJobSnapshot,
): job is Extract<OptimizationJobSnapshot, { status: 'queued' | 'running' }> {
  return job.status === 'queued' || job.status === 'running'
}
