import type { FreeScheduleEntitlement, LicenseOperator, LicenseConfig, OptimizeEstimateBucket, PermissionMode, ReorderCheckResult, WorkspaceResultHistoryItem } from "../../../src/lib/types"
import { type CdkRecord } from "../../handlers/license-utils"
import type { UsageReasonCode } from "../../storage/usage-store";
import { type OptimizeJobPriority } from "../../storage/optimize-job-store"
import type { ScenarioComparisonFactors } from '../../../src/lib/scenario-comparison'

export const UPGRADE_MAX_SIMULATIONS = 24;

export const FREE_PREVIEW_MODE = "full_rotation_without_export";

export const INTERMEDIATE_PRODUCTS = ["Pure Gold", "Originium Shard"] as const;

export const FREE_SCHEDULE_REVISION_LIMIT = 3;

export const FREE_SCHEDULE_REVISION_WINDOW_HOURS = 24;

export const SHANGHAI_TIMEZONE = "Asia/Shanghai" as const;

export const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export type ReorderCheckQuota = ReorderCheckResult["quota"];

export type ReorderCheckRecommendation = ReorderCheckResult["recommendation"];

export type ReorderOperatorImpact = ReorderCheckResult["key_operators"][number];

export type ScheduleUsageContext = {
  status: "success" | "failure";
  reason_code: UsageReasonCode;
  permission?: string;
  profile_id?: string;
  cdk_status?: string;
  source?: string;
  schedule_mode?: string;
  fiammetta_enabled?: boolean;
  estimate_bucket?: OptimizeEstimateBucket;
};

export type OptimizeJobSource = "free_preview" | "account_profile" | "scenario_comparison" | "reorder_check";

type OptimizeEstimateSource = "history_p95" | "fallback_p95";

export type OptimizeDurationEstimate = {
  estimated_duration_ms: number;
  estimate_bucket: OptimizeEstimateBucket;
  estimate_source: OptimizeEstimateSource;
  estimate_sample_count: number;
};

type OptimizeRuntimeEstimatePhase = "queued" | "running" | "overdue" | "completed" | "failed";

export type OptimizeRuntimeEstimate = {
  estimated_remaining_ms: number | null;
  estimated_total_ms: number | null;
  estimate_phase: OptimizeRuntimeEstimatePhase;
  estimate_updated_at: string;
};

export const OPTIMIZE_ESTIMATE_FALLBACK_MS: Record<OptimizeEstimateBucket, number> = {
  maa_fiammetta: 28_000,
  maa_fiammetta_with_suggestions: 76_000,
  maa_plain: 9_000,
  maa_plain_with_suggestions: 57_000,
  rotation: 4_000,
  rotation_with_suggestions: 52_000,
  scenario_comparison: 90_000,
};

export const OPTIMIZE_ESTIMATE_MIN_MS = 2_000;

export const OPTIMIZE_ESTIMATE_MIN_SAMPLES = 20;

export const OPTIMIZE_ESTIMATE_HISTORY_DAYS = 30;

type OptimizeJobPayloadBase = {
  submittedAt: number;
  operators: LicenseOperator[];
  effectiveConfig: LicenseConfig;
  scheduleUsageBase: Partial<ScheduleUsageContext>;
  activeProfileId: string | null;
  isPreviewProfile: boolean;
  isPreviewTrial: boolean;
  freeScheduleDecision: Extract<FreeScheduleGenerateDecision, { ok: true }> | null;
  estimate: OptimizeDurationEstimate;
  request: {
    include_upgrade_suggestions: boolean;
    upgrade_suggestions_allowed: boolean;
    history_source?: unknown;
  };
};

export type OptimizeJobPayload = OptimizeJobPayloadBase & {
  version: 3;
  configPermission: OptimizeConfigPermission;
  cdkUsageRef: Pick<CdkRecord, 'code_hash'> | null;
};

export function createPersistedOptimizeJobPayload(input: Omit<OptimizeJobPayload, 'version'>): OptimizeJobPayload {
  return { version: 3, ...input };
}

export type ScenarioComparisonJobPayload = {
  version: 3;
  kind: 'scenario_comparison';
  submittedAt: number;
  operators: LicenseOperator[];
  effectiveConfig: LicenseConfig;
  activeProfileId: string;
  factors: ScenarioComparisonFactors;
  estimate: OptimizeDurationEstimate;
};

export type ReorderCheckJobPayload = {
  version: 3;
  kind: 'reorder_check';
  submittedAt: number;
  operators: LicenseOperator[];
  effectiveConfig: LicenseConfig;
  activeProfileId: string;
  isPreviewTrial: boolean;
  baseline: WorkspaceResultHistoryItem;
  estimate: OptimizeDurationEstimate;
};

export type OptimizationJobPayload = OptimizeJobPayload | ScenarioComparisonJobPayload | ReorderCheckJobPayload;

export class UnsupportedOptimizationJobPayloadError extends Error {
  constructor(readonly payloadVersion: unknown) {
    super(`Unsupported optimization job payload version: ${String(payloadVersion ?? 'missing')}`)
    this.name = 'UnsupportedOptimizationJobPayloadError'
  }
}

export function normalizePersistedOptimizationJobPayload(value: unknown): OptimizationJobPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnsupportedOptimizationJobPayloadError(undefined)
  }

  const record = value as Record<string, unknown>
  const request = record.request
  if (request && typeof request === 'object' && !Array.isArray(request)
    && (request as Record<string, unknown>).suggestions_only === true) {
    throw new UnsupportedOptimizationJobPayloadError(record.version)
  }
  if (record.version !== 3) {
    throw new UnsupportedOptimizationJobPayloadError(record.version)
  }
  if ('kind' in record
    && record.kind !== 'scenario_comparison'
    && record.kind !== 'reorder_check') {
    throw new UnsupportedOptimizationJobPayloadError(record.version)
  }
  return value as OptimizationJobPayload
}

export type PreparedOptimizeJob = {
  payload: OptimizationJobPayload;
  ownerKey: string;
  priority: OptimizeJobPriority;
  priorityValue: number;
  permission: string | null;
  source: OptimizeJobSource;
  rewardUserId?: string | null;
  usePriorityCoupon?: boolean;
  rewardItemCodes?: string[];
  behaviorIdentity?: { userId: string; sessionTokenHash: string };
};

export type OptimizeConfigPermission = PermissionMode | "free_preview";

export type FreeScheduleGenerateDecision =
  | { ok: true; mode: "revision" | "strong_reorder_bonus"; entitlement: FreeScheduleEntitlement }
  | { ok: false; status: number; message: string; entitlement: FreeScheduleEntitlement };

export type NormalizedRoomOperator = {
  id?: string;
  name: string;
  key: string;
};

export type ReorderRoomSnapshot = {
  key: string;
  roomType: string;
  roomIndex: number;
  product: string;
  operators: NormalizedRoomOperator[];
  operatorKeySet: Set<string>;
  signature: string;
};

export type ReorderPlanComparison = {
  changed_room_count: number;
  affected_facility_types: string[];
  core_combo_changed: boolean;
  key_operators: ReorderOperatorImpact[];
};
