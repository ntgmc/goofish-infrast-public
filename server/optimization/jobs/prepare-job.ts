import type { LicenseFile } from "../../../src/lib/types";
import type { CreateOptimizationJobRequest } from "../../../src/lib/optimization-contracts";
import { canUseUpgradeFeatures, evaluateOperatorRisk, formatOperatorRiskBlockMessage, formatRiskFreezeMessage, recordSoftBlockedRiskEvent, getPermissionMode, getCdkRecordStore, getRiskControlSettings, type CdkRecord, normalizePermissionMode, resolveConfigForPermission, resolveFreePreviewConfig } from "../../handlers/license-utils";
import { getWorkspace, emptyWorkspace, getProfileForUser, isDepotValueProfile, isFreePreviewProfile, updateProfileWorkspaceAtomically } from "../../storage/user-store";
import { requireUserSession } from "../../handlers/user-auth";
import { type OptimizeJobPriority } from "../../storage/optimize-job-store";
import type { ScheduleUsageContext, OptimizeJobSource, PreparedOptimizeJob, OptimizeConfigPermission, FreeScheduleGenerateDecision } from './shared';
import { createPersistedOptimizeJobPayload } from './shared';
import { sanitizeConfigForPublicOptimize, jsonResponse } from './http-core';
import { recordScheduleGenerate, scheduleFailure, resolveFreeScheduleGenerateDecision } from './entitlements';
import { getOptimizeEstimateBucket, getEstimateScheduleMode, isEstimateFiammettaEnabled, resolveOptimizeDurationEstimate } from './job-status';
import { buildScenarioComparisonEstimate } from './job-status';
import { expandScenarioComparison } from '../../../src/lib/scenario-comparison';
import { getEffectiveProfilePermission, isFreePreviewTrialActive } from '../../free-preview-trial';
import { hasCapability } from '../../../src/lib/product-catalog';
import { getFreeScheduleEntitlement } from '../../storage/reorder-admission';
import { requestSchemas } from '../../security/request-policy';
import { getValidatedJson } from '../../security/request-validation';

export async function prepareOptimizeJob(
  req: Request,
): Promise<{ ok: true; prepared: PreparedOptimizeJob } | { ok: false; response: Response }> {
  const submittedAt = Date.now();
  let checkedCdkRecord: CdkRecord | null = null;
  let scheduleUsage = scheduleFailure('optimizer_runtime_error');
  let isScenarioComparison = false;

  const fail = async (body: Record<string, unknown>, status: number): Promise<{ ok: false; response: Response }> => {
    if (!isScenarioComparison) await recordScheduleGenerate(checkedCdkRecord, scheduleUsage, submittedAt);
    return { ok: false, response: jsonResponse(body, status) };
  };

  try {
    const body = await getValidatedJson(req, requestSchemas.optimizationJob) as unknown as CreateOptimizationJobRequest;
    isScenarioComparison = body.kind === 'scenario_comparison';
    const rawBody = body as unknown as Record<string, unknown>;
    if ('use_priority_coupon' in rawBody && typeof rawBody.use_priority_coupon !== 'boolean') {
      return fail({ error: 'use_priority_coupon 必须是布尔值。', code: 'priority_coupon_not_applicable' }, 400);
    }
    if (!body.identity || body.identity.type !== 'profile' || typeof body.identity.profileId !== 'string' || !body.identity.profileId) {
      scheduleUsage = scheduleFailure('validation_failed', { source: 'account_profile' });
      return fail({ error: '优化任务必须使用已登录的账号档案。' }, 400);
    }
    const operators = body.operators;
    const config = body.config;
    const profile_id = body.identity.profileId;
    const ignore_elite = body.kind === 'schedule' ? body.ignoreElite : true;
    const include_current = body.kind === 'schedule' ? body.includeCurrent : false;
    const suggestions_only = body.kind === 'upgrade_suggestions';
    const upgrade_task_payload = body.kind === 'upgrade_suggestions' ? body.upgradeTaskPayload : undefined;
    const history_result_id = body.kind === 'upgrade_suggestions' ? body.historyResultId : undefined;
    const history_source = body.kind === 'schedule' ? body.historySource : undefined;
    const usePriorityCoupon = rawBody.use_priority_coupon === true;

    if (usePriorityCoupon && body.kind !== 'schedule') {
      return fail({ error: '优先计算券仅适用于已登录账号档案的主排班计算。', code: 'priority_coupon_not_applicable' }, 400);
    }

    if (!operators || !config) {
      scheduleUsage = scheduleFailure('validation_failed');
      return fail({ error: 'Missing operators or config' }, 400);
    }

    const auth = await requireUserSession(req);
    if (!auth) {
      scheduleUsage = scheduleFailure('auth_required', { source: 'account_profile' });
      return fail({ error: '请先登录后再提交优化任务。' }, 401);
    }
    let effectiveLicense: LicenseFile;
    let activeProfileId: string | null = null;
    let isPreviewProfile = false;
    let isPreviewTrial = false;

    {
      activeProfileId = profile_id;
      if (!activeProfileId) {
        scheduleUsage = scheduleFailure('auth_profile_missing', { source: 'account_profile' });
        return fail({ error: 'Please select a CDK profile first.' }, 400);
      }
      const profile = await getProfileForUser(auth.user.id, activeProfileId);
      if (!profile) {
        scheduleUsage = scheduleFailure('profile_missing', { profile_id: activeProfileId, source: 'account_profile' });
        return fail({ error: '档案不存在。' }, 404);
      }
      if (isDepotValueProfile(profile)) {
        scheduleUsage = scheduleFailure('permission_denied', { profile_id: activeProfileId, permission: profile.permission, source: 'account_profile' });
        return fail({ error: '仓库分析档案不能用于生成排班。' }, 403);
      }
      isPreviewProfile = isFreePreviewProfile(profile);
      isPreviewTrial = isFreePreviewTrialActive(profile);
      if (isPreviewProfile && !profile.skland_binding) {
        scheduleUsage = scheduleFailure('permission_denied', { profile_id: activeProfileId, permission: 'free_preview', source: 'free_preview' });
        return fail({ error: '免费个人排班档案必须先绑定森空岛后才能生成排班。' }, 403);
      }
      const cdkStore = await getCdkRecordStore();
      checkedCdkRecord = profile.cdk_key ? await cdkStore.get(profile.cdk_key) : null;
      if (checkedCdkRecord?.status === 'revoked' || profile.status === 'revoked') {
        scheduleUsage = scheduleFailure('cdk_revoked', { profile_id: activeProfileId, permission: profile.permission, cdk_status: checkedCdkRecord?.status ?? profile.status, source: 'account_profile' });
        return fail({ error: 'Account authorization has been revoked.' }, 403);
      }
      if (checkedCdkRecord?.status === 'frozen' || profile.status === 'frozen') {
        scheduleUsage = scheduleFailure('cdk_frozen', { profile_id: activeProfileId, permission: profile.permission, cdk_status: checkedCdkRecord?.status ?? profile.status, source: 'account_profile' });
        return fail({ error: formatRiskFreezeMessage(checkedCdkRecord?.freeze_reason || 'Account authorization is frozen.') }, 403);
      }
      effectiveLicense = {
        version: 2,
        order_hash: profile.cdk_order_hash || profile.id.slice(0, 16),
        operators,
        config,
        permission: getEffectiveProfilePermission(profile),
        issued_at: profile.created_at,
        sig: 'account-' + profile.id,
      };
    }

    const optimizePermission: OptimizeConfigPermission = isPreviewProfile && !isPreviewTrial
      ? 'free_preview'
      : getPermissionMode(effectiveLicense);
    const scheduleUsageBase: Partial<ScheduleUsageContext> = {
      permission: optimizePermission,
      profile_id: activeProfileId ?? undefined,
      cdk_status: checkedCdkRecord?.status,
      source: isPreviewProfile ? 'free_preview' : 'account_profile',
    };
    scheduleUsage = scheduleFailure('optimizer_runtime_error', scheduleUsageBase);

    if (isScenarioComparison && (optimizePermission === 'free_preview' || !hasCapability({ permission: optimizePermission }, 'run_scenario_comparison'))) {
      return fail({ error: '当前套餐不包含场景对比实验室。' }, 403);
    }

    if (checkedCdkRecord && normalizePermissionMode(checkedCdkRecord.permission) === 'advanced') {
      const riskSettings = await getRiskControlSettings();
      if (riskSettings.operator_data_risk_enabled) {
        const operatorRisk = evaluateOperatorRisk(checkedCdkRecord, operators);
        if (!operatorRisk.ok) {
          const blocked = await recordSoftBlockedRiskEvent(checkedCdkRecord, operatorRisk.event, formatOperatorRiskBlockMessage(operatorRisk.event.reason));
          scheduleUsage = scheduleFailure(blocked.frozen ? 'risk_frozen' : 'risk_soft_blocked', { ...scheduleUsageBase, cdk_status: blocked.record.status });
          return fail({ error: blocked.message }, blocked.frozen ? 403 : 409);
        }
      }
    }

    const canUseUpgrades = (!isPreviewProfile || isPreviewTrial) && canUseUpgradeFeatures(effectiveLicense);
    if (!canUseUpgrades && (ignore_elite || include_current || suggestions_only)) {
      scheduleUsage = scheduleFailure('permission_denied', scheduleUsageBase);
      return fail({ error: '当前套餐不包含练度提升建议。' }, 403);
    }

    const configForPermission = isPreviewProfile && !isPreviewTrial
      ? resolveFreePreviewConfig(config)
      : resolveConfigForPermission(getPermissionMode(effectiveLicense), config);
    if (!configForPermission.ok) {
      scheduleUsage = scheduleFailure('permission_denied', scheduleUsageBase);
      return fail({ error: configForPermission.message }, 403);
    }

    const effectiveConfig = sanitizeConfigForPublicOptimize(configForPermission.config, optimizePermission);
    if (body.kind === 'scenario_comparison') {
      if (!activeProfileId) return fail({ error: '场景对比实验室缺少账号档案。' }, 400);
      let expansion;
      try {
        expansion = expandScenarioComparison(effectiveConfig, body.factors);
      } catch (error) {
        return fail({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
      const estimate = buildScenarioComparisonEstimate(expansion.scenarios.length, expansion.variableScenarioCount);
      if (estimate.estimated_duration_ms > 10 * 60_000) {
        return fail({ error: '场景组合预计计算时间超过十分钟上限，请减少场景或变量。', code: 'scenario_cost_exceeded' }, 429);
      }
      return {
        ok: true,
        prepared: {
          ownerKey: 'profile:' + activeProfileId,
          priority: 'analysis',
          priorityValue: 5,
          permission: optimizePermission,
          source: 'scenario_comparison',
          rewardUserId: null,
          usePriorityCoupon: false,
          payload: {
            version: 3,
            kind: 'scenario_comparison',
            submittedAt,
            operators,
            effectiveConfig,
            activeProfileId,
            factors: body.factors,
            estimate,
          },
        },
      };
    }
    const estimateBucket = getOptimizeEstimateBucket(effectiveConfig);
    Object.assign(scheduleUsageBase, {
      schedule_mode: getEstimateScheduleMode(estimateBucket),
      fiammetta_enabled: isEstimateFiammettaEnabled(estimateBucket),
      estimate_bucket: estimateBucket,
    });
    scheduleUsage = scheduleFailure('optimizer_runtime_error', scheduleUsageBase);
    let previewWorkspaceForGeneration = auth && activeProfileId && isPreviewProfile
      ? await getWorkspace(activeProfileId) ?? emptyWorkspace(activeProfileId)
      : null;
    let freeScheduleDecision: Extract<FreeScheduleGenerateDecision, { ok: true }> | null = null;
    if (isPreviewProfile && !isPreviewTrial && activeProfileId && previewWorkspaceForGeneration) {
      const entitlement = await getFreeScheduleEntitlement(
        activeProfileId,
        previewWorkspaceForGeneration.free_schedule_entitlement,
      );
      const decision = resolveFreeScheduleGenerateDecision(entitlement);
      if (!decision.ok) {
        scheduleUsage = scheduleFailure('permission_denied', scheduleUsageBase);
        if (decision.entitlement.locked_at !== previewWorkspaceForGeneration.free_schedule_entitlement?.locked_at
          || decision.entitlement.lock_reason !== previewWorkspaceForGeneration.free_schedule_entitlement?.lock_reason) {
          previewWorkspaceForGeneration = await updateProfileWorkspaceAtomically(activeProfileId, (currentWorkspace) => ({
            ...(currentWorkspace ?? emptyWorkspace(activeProfileId)),
            free_schedule_entitlement: decision.entitlement,
            updated_at: new Date().toISOString(),
          }));
        }
        return fail({ error: decision.message, free_schedule_entitlement: decision.entitlement }, decision.status);
      }
      freeScheduleDecision = decision;
    }

    const source: OptimizeJobSource = suggestions_only
      ? 'optimize_suggestions'
      : isPreviewProfile ? 'free_preview' : 'account_profile';
    const priority: OptimizeJobPriority = usePriorityCoupon ? 'priority_coupon' : isPreviewProfile ? 'standard' : 'paid';
    const ownerKey = 'profile:' + activeProfileId;
    const estimate = await resolveOptimizeDurationEstimate(estimateBucket);

    return {
      ok: true,
      prepared: {
        ownerKey,
        priority,
        priorityValue: priority === 'priority_coupon' ? 20 : priority === 'paid' ? 10 : 0,
        permission: scheduleUsageBase.permission ?? null,
        source,
        rewardUserId: usePriorityCoupon ? auth.user.id : null,
        usePriorityCoupon,
        payload: createPersistedOptimizeJobPayload({
          submittedAt,
          operators,
          effectiveConfig,
          configPermission: optimizePermission,
          cdkUsageRef: checkedCdkRecord ? { code_hash: checkedCdkRecord.code_hash } : null,
          scheduleUsageBase,
          activeProfileId,
          isPreviewProfile,
          isPreviewTrial,
          freeScheduleDecision,
          estimate,
          request: { ignore_elite, include_current, suggestions_only, upgrade_task_payload, history_result_id, history_source },
        }),
      },
    };
  } catch (err: unknown) {
    console.error('optimize-schedule enqueue error:', err);
    const message = 'Internal server error';
    if (!isScenarioComparison) await recordScheduleGenerate(checkedCdkRecord, scheduleUsage, submittedAt);
    return { ok: false, response: jsonResponse({ error: message }, 500) };
  }
}
