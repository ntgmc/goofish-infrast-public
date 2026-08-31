import type { LicenseOperator, LicenseConfig, OptimizeResult } from "../../../src/lib/types";
import { canonicalJson, type CdkRecord, incrementCdkScheduleGenerateCount } from "../../handlers/license-utils";
import { countSuccessfulUsageEventsForProfileInRange, recordUsageEvent } from "../../handlers/usage-stats";
import type { UsageReasonCode } from "../../storage/usage-store";
import { hasDatabaseUrl } from '../../storage/postgres';
import { countReorderCheckQuota, countReorderCheckQuotas } from '../../storage/reorder-quota-store';
import { settleCdkScheduleQuota } from '../../storage/cdk-store';
import type { ReorderCheckQuota, ScheduleUsageContext } from './shared';
import { FREE_PREVIEW_MODE, SHANGHAI_TIMEZONE, SHANGHAI_UTC_OFFSET_MS } from './shared';
import { REORDER_CHECK_MONTHLY_LIMIT } from '../../reorder-check-policy';

export function getDownloadableHistoryResult(result: OptimizeResult): OptimizeResult {
  return result;
}

export function limitPreviewOptimizeResult(result: OptimizeResult): OptimizeResult {
  const {
    daily_production,
    maa_default_comparison,
    raw_results,
    raw_total_efficiency,
    total_efficiency,
    upgrade_suggestions,
    ...safeResult
  } = result;
  void daily_production;
  void maa_default_comparison;
  void raw_results;
  void raw_total_efficiency;
  void total_efficiency;
  void upgrade_suggestions;

  return {
    ...safeResult,
    plans: result.plans ?? [],
    raw_results: [],
    preview_limit: {
      mode: FREE_PREVIEW_MODE,
      hidden_room_count: 0,
      notice: "免费个人排班可查看完整游戏内轮换队列，但不包含导出、原始数据和高级分析。",
    },
  };
}
export function sameConfig(left: LicenseConfig, right: LicenseConfig): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function countOwnedOperators(operators: LicenseOperator[]): number {
  return operators.filter((operator) => operator.own !== false).length;
}

export async function recordScheduleGenerate(
  cdkRecord: Pick<CdkRecord, 'code_hash'> & Partial<Pick<CdkRecord, 'permission' | 'status'>> | null,
  context: ScheduleUsageContext,
  timing: { submittedAt: number; attemptStartedAt?: number },
  jobId?: string,
): Promise<void> {
  try {
    await recordUsageEvent("schedule_generate", {
      status: context.status,
      reason_code: context.reason_code,
      duration_ms: Date.now() - timing.submittedAt,
      ...(timing.attemptStartedAt !== undefined && { compute_duration_ms: Date.now() - timing.attemptStartedAt }),
      permission: context.permission ?? cdkRecord?.permission ?? undefined,
      profile_id: context.profile_id,
      cdk_status: context.cdk_status ?? cdkRecord?.status,
      source: context.source ?? "optimize",
      schedule_mode: context.schedule_mode,
      fiammetta_enabled: context.fiammetta_enabled,
      estimate_bucket: context.estimate_bucket,
    }, jobId ? `optimize-job/${jobId}/schedule-generate` : undefined);
  } catch (error) {
    console.warn("usage stats schedule generate skipped:", error);
  }

  if (!cdkRecord || context.status !== "success") return;

  try {
    await incrementCdkScheduleGenerateCount(cdkRecord, jobId);
  } catch (error) {
    console.warn("license schedule generate count skipped:", error);
  }
}

export async function applyScheduleGenerateEffects(
  cdkRecord: Pick<CdkRecord, 'code_hash'> | null,
  context: ScheduleUsageContext,
  timing: { submittedAt: number; attemptStartedAt?: number },
  jobId: string,
  countCdkGeneration = true,
): Promise<void> {
  await recordUsageEvent("schedule_generate", {
    status: context.status,
    reason_code: context.reason_code,
    duration_ms: Date.now() - timing.submittedAt,
    ...(timing.attemptStartedAt !== undefined && { compute_duration_ms: Date.now() - timing.attemptStartedAt }),
    permission: context.permission,
    profile_id: context.profile_id,
    cdk_status: context.cdk_status,
    source: context.source ?? "optimize",
    schedule_mode: context.schedule_mode,
    fiammetta_enabled: context.fiammetta_enabled,
    estimate_bucket: context.estimate_bucket,
  }, `optimize-job/${jobId}/schedule-generate`)

  if (!cdkRecord || context.status !== "success" || !countCdkGeneration) return
  if (await settleCdkScheduleQuota(jobId)) return
  const applied = await incrementCdkScheduleGenerateCount(cdkRecord, jobId)
  if (!applied) throw new Error('CDK schedule generation count could not be applied.')
}

export function scheduleFailure(reasonCode: UsageReasonCode, context: Partial<ScheduleUsageContext> = {}): ScheduleUsageContext {
  return {
    status: "failure",
    reason_code: reasonCode,
    source: "optimize",
    ...context,
  };
}

export function scheduleSuccess(context: Partial<ScheduleUsageContext> = {}): ScheduleUsageContext {
  return {
    status: "success",
    reason_code: "ok",
    source: "optimize",
    ...context,
  };
}

function getShanghaiMonthWindow(now = new Date()): { start_at: string; end_at: string } {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const year = shanghaiNow.getUTCFullYear();
  const month = shanghaiNow.getUTCMonth();
  const startUtc = Date.UTC(year, month, 1) - SHANGHAI_UTC_OFFSET_MS;
  const endUtc = Date.UTC(year, month + 1, 1) - SHANGHAI_UTC_OFFSET_MS;
  return {
    start_at: new Date(startUtc).toISOString(),
    end_at: new Date(endUtc).toISOString(),
  };
}

function getShanghaiMonthKey(now = new Date()): string {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const year = shanghaiNow.getUTCFullYear();
  const month = String(shanghaiNow.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function buildReorderCheckQuota(used: number, resetAt: string): ReorderCheckQuota {
  const normalizedUsed = Math.max(0, Math.floor(used));
  return {
    limit: REORDER_CHECK_MONTHLY_LIMIT,
    used: normalizedUsed,
    remaining: Math.max(0, REORDER_CHECK_MONTHLY_LIMIT - normalizedUsed),
    reset_at: resetAt,
    timezone: SHANGHAI_TIMEZONE,
  };
}

export async function getReorderCheckQuota(profileId: string): Promise<ReorderCheckQuota> {
  const window = getShanghaiMonthWindow();
  const used = hasDatabaseUrl()
    ? await countReorderCheckQuota(profileId, getShanghaiMonthKey())
    : await countSuccessfulUsageEventsForProfileInRange(
        "reorder_check",
        profileId,
        window.start_at,
        window.end_at,
      );
  return buildReorderCheckQuota(used, window.end_at);
}

export async function getReorderCheckQuotas(profileIds: string[]): Promise<Map<string, ReorderCheckQuota>> {
  const uniqueProfileIds = [...new Set(profileIds)]
  if (uniqueProfileIds.length === 0) return new Map()
  const window = getShanghaiMonthWindow()
  if (!hasDatabaseUrl()) {
    const quotas = await Promise.all(uniqueProfileIds.map(async (profileId) => [
      profileId,
      await getReorderCheckQuota(profileId),
    ] as const))
    return new Map(quotas)
  }
  const usage = await countReorderCheckQuotas(uniqueProfileIds, getShanghaiMonthKey())
  return new Map(uniqueProfileIds.map((profileId) => [
    profileId,
    buildReorderCheckQuota(usage.get(profileId) ?? 0, window.end_at),
  ]))
}
