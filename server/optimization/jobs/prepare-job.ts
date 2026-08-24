import type { LicenseFile } from "../../../src/lib/types";
import type { CreateOptimizationJobRequest } from "../../../src/lib/optimization-contracts";
import { canUseUpgradeFeatures, evaluateOperatorRisk, formatOperatorRiskBlockMessage, recordOperatorFingerprint, recordSoftBlockedRiskEvent, getPermissionMode, getRiskControlSettings, getCdkProfileDuration, isProfileCdkRecord, type CdkRecord, normalizePermissionMode, resolveConfigForPermission, resolveFreePreviewConfig } from "../../handlers/license-utils";
import { resolveProfileAuthorization } from '../../handlers/profile-authorization';
import { getWorkspace, emptyWorkspace, getProfileForUser, isDepotValueProfile, isFreePreviewProfile, normalizeProfileKind, updateProfileWorkspaceAtomically } from "../../storage/user-store";
import { getProfileOptimizationResult } from '../../storage/optimization-result-store';
import { requireUserSession } from "../../handlers/user-auth";
import { type OptimizeJobPriority } from "../../storage/optimize-job-store";
import type { ScheduleUsageContext, OptimizeJobSource, PreparedOptimizeJob, OptimizeConfigPermission, FreeScheduleGenerateDecision } from './shared';
import { createPersistedOptimizeJobPayload } from './shared';
import { sanitizeConfigForPublicOptimize, jsonResponse } from './http-core';
import { recordScheduleGenerate, scheduleFailure, resolveFreeScheduleGenerateDecision } from './entitlements';
import { getOptimizeEstimateBucket, getEstimateScheduleMode, isEstimateFiammettaEnabled, resolveOptimizeDurationEstimate } from './job-status';
import { buildScenarioComparisonEstimate } from './job-status';
import { expandScenarioComparison } from '../../../src/lib/scenario-comparison';
import { isFreePreviewTrialActive } from '../../free-preview-trial';
import { hasCapability } from '../../../src/lib/product-catalog';
import { getFreeScheduleEntitlement } from '../../storage/reorder-admission';
import { requestSchemas } from '../../security/request-policy';
import { getValidatedJson } from '../../security/request-validation';
import { formatOptimizeJobHardTimeout, getOptimizeJobHardTimeoutMs } from '../../optimize-job-config';
import { recordOperatorDataAnomalyBehaviorEvent } from '../../behavior-risk/service';
import type { MeteredBillingKind, MeteredBillingOperation } from '../../../src/lib/metered-billing';
import { normalizePointsAmount } from '../../../src/lib/balance-contracts';
import { requireMeteredBillingFeature } from '../../feature-gate';

export async function prepareOptimizeJob(
  req: Request,
): Promise<{ ok: true; prepared: PreparedOptimizeJob } | { ok: false; response: Response }> {
  const submittedAt = Date.now();
  let checkedCdkRecord: CdkRecord | null = null;
  let scheduleUsage = scheduleFailure('optimizer_runtime_error');
  let isScenarioComparison = false;

  const fail = async (body: Record<string, unknown>, status: number): Promise<{ ok: false; response: Response }> => {
    if (!isScenarioComparison) await recordScheduleGenerate(checkedCdkRecord, scheduleUsage, { submittedAt });
    return { ok: false, response: jsonResponse(body, status) };
  };

  try {
    const body = await getValidatedJson(req, requestSchemas.optimizationJob) as unknown as CreateOptimizationJobRequest;
    isScenarioComparison = body.kind === 'scenario_comparison';
    const rawBody = body as unknown as Record<string, unknown>;
    if ('use_priority_coupon' in rawBody && typeof rawBody.use_priority_coupon !== 'boolean') {
      return fail({ error: '优先计算券选项无效，请重新选择。', code: 'priority_coupon_not_applicable' }, 400);
    }
    if (!body.identity || body.identity.type !== 'profile' || typeof body.identity.profileId !== 'string' || !body.identity.profileId) {
      scheduleUsage = scheduleFailure('validation_failed', { source: 'account_profile' });
      return fail({ error: '优化任务必须使用已登录的账号档案。' }, 400);
    }
    const operators = body.operators;
    const config = body.config;
    const profile_id = body.identity.profileId;
    const includeUpgradeSuggestions = body.kind === 'schedule' && body.includeUpgradeSuggestions;
    const history_source = body.kind === 'schedule' ? body.historySource : undefined;
    const billingOperation: MeteredBillingOperation = body.kind === 'scenario_comparison'
      ? 'scenario_comparison'
      : body.billing_operation ?? 'main_schedule';
    const baselineHistoryId = body.kind === 'schedule' ? body.baseline_history_id?.trim() : undefined;
    const submittedItems = Array.isArray(body.use_items) ? body.use_items : [];
    if (new Set(submittedItems).size !== submittedItems.length) {
      return fail({ error: '同一种道具每次最多使用一张。', code: 'duplicate_item' }, 400);
    }
    const requestedItems = new Set<string>(submittedItems);
    if (rawBody.use_priority_coupon === true) requestedItems.add('priority_compute_coupon');
    const usePriorityCoupon = requestedItems.has('priority_compute_coupon');
    const allowedItems = body.kind === 'schedule'
      ? new Set(['priority_compute_coupon', 'training_diagnosis_coupon', 'additional_recompute_coupon'])
      : new Set(['scenario_simulation_coupon']);
    if ([...requestedItems].some((item) => !allowedItems.has(item))) {
      return fail({ error: '所选道具不能用于当前计算类型。', code: 'item_not_applicable' }, 400);
    }

    if (usePriorityCoupon && body.kind !== 'schedule') {
      return fail({ error: '优先计算券仅适用于已登录账号档案的主排班计算。', code: 'priority_coupon_not_applicable' }, 400);
    }

    if (!operators || !config) {
      scheduleUsage = scheduleFailure('validation_failed');
      return fail({ error: '请先填写干员数据和排班设置。' }, 400);
    }

    const auth = await requireUserSession(req);
    if (!auth) {
      scheduleUsage = scheduleFailure('auth_required', { source: 'account_profile' });
      return fail({ error: '请先登录后再提交优化任务。' }, 401);
    }
    let effectiveLicense: LicenseFile;
    let activeProfileId: string | null = null;
    let activeProfileUid: string | null = null;
    let isPreviewProfile = false;
    let isPreviewTrial = false;
    let personalUseAudit: PreparedOptimizeJob['personalUseAudit'];
    let meteredBilling: PreparedOptimizeJob['billing'] = null;

    {
      activeProfileId = profile_id;
      if (!activeProfileId) {
        scheduleUsage = scheduleFailure('auth_profile_missing', { source: 'account_profile' });
        return fail({ error: '请先选择游戏账号。' }, 400);
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
      const profileKind = normalizeProfileKind(profile);
      if (profileKind === 'free_preview' || profileKind === 'metered_personal') {
        personalUseAudit = { userId: auth.user.id, profileId: activeProfileId };
      }
      const meteredFeatureGate = await requireMeteredBillingFeature(profileKind);
      if (meteredFeatureGate) return { ok: false, response: meteredFeatureGate };
      if (profile.archived_at) {
        scheduleUsage = scheduleFailure('permission_denied', { profile_id: activeProfileId, permission: profile.permission, source: 'account_profile' });
        return fail({ error: '归档档案不能提交任务。', code: 'profile_archived' }, 409);
      }
      const authorization = await resolveProfileAuthorization(profile);
      if (!authorization.ok) {
        const reason = authorization.code.includes('revoked')
          ? 'cdk_revoked'
          : authorization.code.includes('frozen')
            ? 'cdk_frozen'
            : 'permission_denied';
        scheduleUsage = scheduleFailure(reason, {
          profile_id: activeProfileId,
          permission: profile.permission,
          cdk_status: profile.status,
          source: 'account_profile',
        });
        return fail({ error: authorization.message, code: authorization.code }, authorization.status);
      }
      checkedCdkRecord = authorization.cdkRecord;
      if (profileKind === 'free_preview' && isScenarioComparison) {
        scheduleUsage = scheduleFailure('permission_denied', { profile_id: activeProfileId, permission: profile.permission, source: 'account_profile' });
        return fail({ error: '免费预览档案不开放场景对比实验室。', code: 'capability_not_available' }, 403);
      }
      if (profileKind === 'metered_personal' || profileKind === 'metered_commercial') {
        const accepted = normalizePointsAmount(body.accepted_max_points);
        if (!body.billing_quote_id || !body.pricing_version || !accepted) {
          return fail({ error: '缺少已确认的计费报价，请刷新报价后重新确认。', code: 'pricing_changed' }, 409);
        }
        meteredBilling = {
          userId: auth.user.id,
          operation: billingOperation,
          billingKind: profileKind as MeteredBillingKind,
          confirmation: {
            quoteId: body.billing_quote_id,
            pricingVersion: body.pricing_version,
            acceptedMaxPoints: accepted,
          },
        };
      }
      isPreviewProfile = isFreePreviewProfile(profile);
      activeProfileUid = profile.skland_binding?.uid ?? null;
      isPreviewTrial = isFreePreviewTrialActive(profile);
      const unlimitedService = Boolean(checkedCdkRecord && isProfileCdkRecord(checkedCdkRecord)
        && getCdkProfileDuration(checkedCdkRecord) === 'lifetime');
      const hasBillingQuoteFields = Boolean(body.billing_quote_id || body.pricing_version || body.accepted_max_points);
      if (billingOperation === 'scenario_comparison' && profileKind === 'cdk' && hasBillingQuoteFields) {
        return fail({ error: '周期卡场景对比使用卡内次数，不需要 300 积分报价。', code: 'billing_not_applicable' }, 409);
      }
      if (billingOperation === 'incremental_recompute' && unlimitedService && hasBillingQuoteFields) {
        return fail({ error: '终身卡已包含无限个人增量重算，不需要 700 积分报价。', code: 'billing_not_applicable' }, 409);
      }
      if (billingOperation !== 'main_schedule' && !meteredBilling) {
        const accepted = normalizePointsAmount(body.accepted_max_points);
        if (body.billing_quote_id && body.pricing_version && accepted) {
          meteredBilling = {
            userId: auth.user.id,
            operation: billingOperation,
            billingKind: 'metered_personal',
            confirmation: {
              quoteId: body.billing_quote_id,
              pricingVersion: body.pricing_version,
              acceptedMaxPoints: accepted,
            },
          };
        }
      }
      if (billingOperation === 'incremental_recompute') {
        if (isPreviewProfile) {
          return fail({ error: '免费预览档案不能使用个人增量重算，请使用免费修订或追加重算券。', code: 'operation_not_available' }, 409);
        }
        if (!baselineHistoryId) {
          return fail({ error: '个人增量重算必须绑定一份已有成功结果。', code: 'baseline_required' }, 409);
        }
        const baseline = await getProfileOptimizationResult(activeProfileId, baselineHistoryId);
        if (!baseline || baseline.archived_at) {
          return fail({ error: '增量重算基线不存在或已归档，请先选择最新成功结果。', code: 'baseline_not_found' }, 409);
        }
        if (!unlimitedService && !meteredBilling) {
          return fail({ error: '当前档案需要先确认 700 积分的增量重算报价。', code: 'pricing_changed' }, 409);
        }
      }
      if (isPreviewProfile && !profile.skland_binding) {
        scheduleUsage = scheduleFailure('permission_denied', { profile_id: activeProfileId, permission: 'free_preview', source: 'free_preview' });
        return fail({ error: '免费个人排班档案必须先绑定森空岛后才能生成排班。' }, 403);
      }
      effectiveLicense = {
        version: 2,
        order_hash: profile.cdk_order_hash || profile.id.slice(0, 16),
        operators,
        config,
        permission: authorization.permission,
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

    const hasScenarioCapability = optimizePermission !== 'free_preview'
      && hasCapability({ permission: optimizePermission }, 'run_scenario_comparison');
    const useScenarioCoupon = isScenarioComparison && !hasScenarioCapability
      && requestedItems.has('scenario_simulation_coupon');
    if (isScenarioComparison && !hasScenarioCapability && !useScenarioCoupon && !meteredBilling) {
      return fail({ error: '当前套餐需要先确认 300 积分的场景对比包。', code: 'pricing_changed' }, 409);
    }
    // Periodic CDKs reserve and consume their catalog-defined scenario quota in
    // the job admission transaction. Only metered profiles use the 300-point
    // quote path; lifetime CDKs have an unlimited quota and need no quote.

    if (checkedCdkRecord && isProfileCdkRecord(checkedCdkRecord) && normalizePermissionMode(checkedCdkRecord.permission) === 'advanced') {
      const riskSettings = await getRiskControlSettings();
      if (riskSettings.operator_data_risk_enabled) {
        const operatorRisk = evaluateOperatorRisk(checkedCdkRecord, operators);
        if (!operatorRisk.ok) {
          const blocked = await recordSoftBlockedRiskEvent(
            checkedCdkRecord,
            operatorRisk.event,
            formatOperatorRiskBlockMessage(operatorRisk.event.reason),
            operatorRisk.fingerprint,
          );
          await recordOperatorDataAnomalyBehaviorEvent({
            req,
            auth,
            profileId: activeProfileId,
            uid: activeProfileUid,
            anomalyType: operatorRisk.event.type,
            fingerprintHash: operatorRisk.fingerprint.hash,
            ownedCount: operatorRisk.fingerprint.owned_count,
            occurredAt: new Date(operatorRisk.event.at),
          });
          scheduleUsage = scheduleFailure(blocked.frozen ? 'risk_frozen' : 'risk_soft_blocked', { ...scheduleUsageBase, cdk_status: blocked.record.status });
          return fail({ error: blocked.message }, blocked.frozen ? 403 : 409);
        }
        checkedCdkRecord = await recordOperatorFingerprint(checkedCdkRecord, operatorRisk.fingerprint);
      }
    }

    const hasUpgradeCapability = (!isPreviewProfile || isPreviewTrial) && canUseUpgradeFeatures(effectiveLicense);
    const useTrainingCoupon = body.kind === 'schedule' && !hasUpgradeCapability
      && requestedItems.has('training_diagnosis_coupon');
    if (body.kind === 'schedule' && requestedItems.has('training_diagnosis_coupon') && !body.includeUpgradeSuggestions) {
      return fail({ error: '练度诊断券必须与练度诊断功能一同启用。', code: 'item_not_applicable' }, 400);
    }
    const canUseUpgrades = hasUpgradeCapability || useTrainingCoupon;

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
      if (estimate.estimated_duration_ms > getOptimizeJobHardTimeoutMs()) {
        return fail({ error: `场景组合预计计算时间超过${formatOptimizeJobHardTimeout()}上限，请减少场景或变量。`, code: 'scenario_cost_exceeded' }, 429);
      }
      const queuePriority = getScenarioComparisonQueuePriority(isPreviewProfile, isPreviewTrial);
      return {
        ok: true,
        prepared: {
          ownerKey: 'profile:' + activeProfileId,
          priority: queuePriority.kind,
          priorityValue: queuePriority.value,
          permission: optimizePermission,
          source: 'scenario_comparison',
          rewardUserId: useScenarioCoupon ? auth.user.id : null,
          usePriorityCoupon: false,
          rewardItemCodes: useScenarioCoupon ? ['scenario_simulation_coupon'] : [],
          personalUseAudit,
          payload: {
            version: 3,
            kind: 'scenario_comparison',
            submittedAt,
            operators,
            effectiveConfig,
            activeProfileId,
            cdkUsageRef: checkedCdkRecord ? { code_hash: checkedCdkRecord.code_hash } : null,
            factors: body.factors,
            estimate,
          },
          billing: meteredBilling,
        },
      };
    }
    const estimateBucket = getOptimizeEstimateBucket(effectiveConfig, includeUpgradeSuggestions && canUseUpgrades);
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
        const additionalCouponApplicable = requestedItems.has('additional_recompute_coupon')
          && decision.entitlement.lock_reason === 'revision_limit'
          && !decision.entitlement.confirmed_at
          && Boolean(decision.entitlement.first_generated_at)
          && Date.now() - Date.parse(decision.entitlement.first_generated_at!) < 24 * 60 * 60_000;
        if (additionalCouponApplicable) {
          freeScheduleDecision = {
            ok: true,
            mode: 'revision',
            entitlement: { ...decision.entitlement, locked_at: null, lock_reason: null },
          };
        } else {
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
      } else {
        if (requestedItems.has('additional_recompute_coupon')) {
          return fail({ error: '当前仍有免费修订次数，无需使用追加重算券。', code: 'item_not_applicable' }, 409);
        }
        freeScheduleDecision = decision;
      }
    } else if (requestedItems.has('additional_recompute_coupon')) {
      return fail({ error: '追加重算券只适用于仍在修订窗口内的免费预览档案。', code: 'item_not_applicable' }, 400);
    }

    const source: OptimizeJobSource = isPreviewProfile ? 'free_preview' : 'account_profile';
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
        rewardUserId: requestedItems.size > 0 ? auth.user.id : null,
        usePriorityCoupon,
        rewardItemCodes: [
          ...(useTrainingCoupon ? ['training_diagnosis_coupon'] : []),
          ...(requestedItems.has('additional_recompute_coupon') ? ['additional_recompute_coupon'] : []),
        ],
        behaviorIdentity: { userId: auth.user.id, sessionTokenHash: auth.tokenHash },
        personalUseAudit,
        billing: meteredBilling,
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
          request: {
            include_upgrade_suggestions: includeUpgradeSuggestions,
            upgrade_suggestions_allowed: canUseUpgrades,
            history_source,
            billing_operation: billingOperation,
            ...(baselineHistoryId ? { baseline_history_id: baselineHistoryId } : {}),
          },
        }),
      },
    };
  } catch (err: unknown) {
    console.error('optimize-schedule enqueue error:', err);
    const message = 'Internal server error';
    if (!isScenarioComparison) await recordScheduleGenerate(checkedCdkRecord, scheduleUsage, { submittedAt });
    return { ok: false, response: jsonResponse({ error: message }, 500) };
  }
}

export function getScenarioComparisonQueuePriority(
  isPreviewProfile: boolean,
  isPreviewTrial: boolean,
): { kind: OptimizeJobPriority; value: number } {
  return isPreviewProfile && isPreviewTrial
    ? { kind: 'standard', value: 0 }
    : { kind: 'analysis', value: 5 };
}
