import type { FreeScheduleEntitlement, LicenseOperator, LicenseConfig, OptimizeEstimateBucket, PermissionMode } from "../../../src/lib/types"
import { type CdkRecord } from "../../handlers/license-utils"
import type { UsageReasonCode } from "../../storage/usage-store";
import { type OptimizeJobPriority } from "../../storage/optimize-job-store"
import type { ScenarioComparisonFactors } from '../../../src/lib/scenario-comparison'
import type { MeteredBillingKind, MeteredBillingOperation, MeteredQuoteConfirmation } from '../../../src/lib/metered-billing'
import { optimizationJobPayloadSchema } from './runtime-contracts'

export const UPGRADE_MAX_SIMULATIONS = 24;

export const FREE_PREVIEW_MODE = "full_rotation_without_export";

export const INTERMEDIATE_PRODUCTS = ["Pure Gold", "Originium Shard"] as const;

export const SHANGHAI_TIMEZONE = "Asia/Shanghai" as const;

export const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

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

export type OptimizeJobSource = "free_preview" | "account_profile" | "scenario_comparison";

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
    history_source?: 'generated' | 'applied_suggestions';
    billing_operation?: MeteredBillingOperation;
    baseline_history_id?: string;
  };
};

export type OptimizeJobPayload = OptimizeJobPayloadBase & {
  version: 3;
  configPermission: OptimizeConfigPermission;
  cdkUsageRef?: Pick<CdkRecord, 'code_hash'> | null;
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
  cdkUsageRef?: Pick<CdkRecord, 'code_hash'> | null;
  factors: ScenarioComparisonFactors;
  estimate: OptimizeDurationEstimate;
};

export type OptimizationJobPayload = OptimizeJobPayload | ScenarioComparisonJobPayload;

export class UnsupportedOptimizationJobPayloadError extends Error {
  constructor(readonly payloadVersion: unknown, readonly details?: string) {
    super(details
      ? `Invalid optimization job payload version ${String(payloadVersion ?? 'missing')}: ${details}`
      : `Unsupported optimization job payload version: ${String(payloadVersion ?? 'missing')}`)
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
    && record.kind !== 'scenario_comparison') {
    throw new UnsupportedOptimizationJobPayloadError(record.version)
  }
  const parsed = optimizationJobPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new UnsupportedOptimizationJobPayloadError(
      record.version,
      parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; '),
    )
  }
  return parsed.data
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
  personalUseAudit?: { userId: string; profileId: string };
  billing?: { userId: string; operation: MeteredBillingOperation; billingKind: MeteredBillingKind; confirmation: MeteredQuoteConfirmation } | null;
};

export type OptimizeConfigPermission = PermissionMode | "free_preview";

type FreeScheduleGenerateDecision =
  | { ok: true; mode: "revision" | "strong_reorder_bonus"; entitlement: FreeScheduleEntitlement }
  | { ok: false; status: number; message: string; entitlement: FreeScheduleEntitlement };
