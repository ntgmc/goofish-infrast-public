import type { FreeScheduleEntitlement, LicenseOperator, LicenseConfig, OptimizeResult } from "../../../src/lib/types";
import { canonicalJson, type CdkRecord, incrementCdkScheduleGenerateCount } from "../../handlers/license-utils";
import { countSuccessfulUsageEventsForProfileInRange, recordUsageEvent } from "../../handlers/usage-stats";
import type { UsageReasonCode } from "../../storage/usage-store";
import type { ReorderCheckQuota, ScheduleUsageContext, FreeScheduleGenerateDecision } from './shared';
import { FREE_PREVIEW_MODE, FREE_SCHEDULE_REVISION_LIMIT, FREE_SCHEDULE_REVISION_WINDOW_HOURS, SHANGHAI_TIMEZONE, SHANGHAI_UTC_OFFSET_MS } from './shared';
import { REORDER_CHECK_MONTHLY_LIMIT } from '../../reorder-check-policy';

export function getDownloadableHistoryResult(result: OptimizeResult): OptimizeResult {
  return result;
}

export function limitPreviewOptimizeResult(result: OptimizeResult, entitlement?: FreeScheduleEntitlement | null): OptimizeResult {
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
      ...(entitlement && { free_schedule_entitlement: entitlement }),
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

  if (!cdkRecord || context.status !== "success") return
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
  const used = await countSuccessfulUsageEventsForProfileInRange(
    "reorder_check",
    profileId,
    window.start_at,
    window.end_at,
  );
  return buildReorderCheckQuota(used, window.end_at);
}

function createFreeScheduleEntitlement(): FreeScheduleEntitlement {
  return {
    first_generated_at: null,
    revision_count: 0,
    revision_limit: FREE_SCHEDULE_REVISION_LIMIT,
    revision_window_hours: FREE_SCHEDULE_REVISION_WINDOW_HOURS,
    confirmed_at: null,
    locked_at: null,
    lock_reason: null,
    strong_reorder_bonus: null,
  };
}

function normalizeFreeScheduleEntitlement(entitlement: FreeScheduleEntitlement | null | undefined): FreeScheduleEntitlement {
  return {
    ...createFreeScheduleEntitlement(),
    ...(entitlement ?? {}),
    revision_count: Math.max(0, Math.floor(Number(entitlement?.revision_count ?? 0))),
    revision_limit: FREE_SCHEDULE_REVISION_LIMIT,
    revision_window_hours: FREE_SCHEDULE_REVISION_WINDOW_HOURS,
    strong_reorder_bonus: entitlement?.strong_reorder_bonus ?? null,
  };
}

function hasUnusedStrongReorderBonus(entitlement: FreeScheduleEntitlement, now = new Date()): boolean {
  const bonus = entitlement.strong_reorder_bonus;
  return Boolean(bonus && bonus.month === getShanghaiMonthKey(now) && !bonus.used_at);
}

export function resolveFreeScheduleGenerateDecision(
  entitlementValue: FreeScheduleEntitlement | null | undefined,
  now = new Date(),
): FreeScheduleGenerateDecision {
  const entitlement = normalizeFreeScheduleEntitlement(entitlementValue);
  if (hasUnusedStrongReorderBonus(entitlement, now)) {
    return { ok: true, mode: "strong_reorder_bonus", entitlement };
  }
  if (!entitlement.first_generated_at) {
    return { ok: true, mode: "revision", entitlement };
  }

  if (entitlement.confirmed_at || entitlement.locked_at) {
    return {
      ok: false,
      status: 403,
      message: "免费完整排班权益已锁定。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。",
      entitlement,
    };
  }

  const firstGeneratedTime = Date.parse(entitlement.first_generated_at);
  const windowMs = FREE_SCHEDULE_REVISION_WINDOW_HOURS * 60 * 60 * 1000;
  if (!Number.isFinite(firstGeneratedTime) || now.getTime() - firstGeneratedTime >= windowMs) {
    const locked = {
      ...entitlement,
      locked_at: now.toISOString(),
      lock_reason: "window_expired" as const,
    };
    return {
      ok: false,
      status: 403,
      message: "免费完整排班确认期已结束。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。",
      entitlement: locked,
    };
  }

  if (entitlement.revision_count >= FREE_SCHEDULE_REVISION_LIMIT) {
    const locked = {
      ...entitlement,
      locked_at: now.toISOString(),
      lock_reason: "revision_limit" as const,
    };
    return {
      ok: false,
      status: 403,
      message: "免费完整排班修正次数已用完。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。",
      entitlement: locked,
    };
  }

  return { ok: true, mode: "revision", entitlement };
}

export function applySuccessfulFreeScheduleGeneration(
  decision: Extract<FreeScheduleGenerateDecision, { ok: true }>,
  now = new Date(),
): FreeScheduleEntitlement {
  const entitlement = normalizeFreeScheduleEntitlement(decision.entitlement);
  const nowIso = now.toISOString();
  if (decision.mode === "strong_reorder_bonus") {
    return {
      ...entitlement,
      strong_reorder_bonus: entitlement.strong_reorder_bonus
        ? { ...entitlement.strong_reorder_bonus, used_at: nowIso }
        : null,
    };
  }

  const nextCount = Math.max(0, entitlement.revision_count) + 1;
  return {
    ...entitlement,
    first_generated_at: entitlement.first_generated_at ?? nowIso,
    revision_count: nextCount,
    ...(nextCount >= FREE_SCHEDULE_REVISION_LIMIT && {
      locked_at: nowIso,
      lock_reason: "revision_limit" as const,
    }),
  };
}
