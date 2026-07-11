import type { LicenseFile } from "../../../src/lib/types";
import type { CreateOptimizationJobRequest } from "../../../src/lib/optimization-contracts";
import { canUseUpgradeFeatures, evaluateClientBindingRisk, evaluateOperatorRisk, formatBindingBlockMessage, formatOperatorRiskBlockMessage, formatRiskFreezeMessage, freezeCdkRecord, recordSoftBlockedRiskEvent, shouldFreezeBindingRisk, getPermissionMode, getCdkRecordStore, getRiskControlSettings, type CdkRecord, normalizePermissionMode, resolveConfigForPermission, resolveFreePreviewConfig } from "../../handlers/license-utils";
import { saveWorkspace, getWorkspace, emptyWorkspace, getProfileForUser, isDepotValueProfile, isFreePreviewProfile, type UserGameAccountRecord } from "../../storage/user-store";
import { requireUserSession } from "../../handlers/user-auth";
import { type OptimizeJobPriority } from "../../storage/optimize-job-store";
import type { ScheduleUsageContext, OptimizeJobSource, PreparedOptimizeJob, OptimizeConfigPermission, FreeScheduleGenerateDecision } from './shared';
import { sanitizeConfigForPublicOptimize, jsonResponse } from './http-core';
import { validateRequestLicense, recordScheduleGenerate, scheduleFailure, resolveFreeScheduleGenerateDecision } from './entitlements';
import { getOptimizeEstimateBucket, getEstimateScheduleMode, isEstimateFiammettaEnabled, resolveOptimizeDurationEstimate } from './job-status';
import { buildScenarioComparisonEstimate } from './job-status';
import { expandScenarioComparison } from '../../../src/lib/scenario-comparison';

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
    const body = await req.json() as CreateOptimizationJobRequest;
    isScenarioComparison = body.kind === 'scenario_comparison';
    const operators = body.operators;
    const config = body.config;
    const license = body.identity?.type === 'license' ? body.identity.license : undefined;
    const activation_token = body.identity?.type === 'license' ? body.identity.activationToken : undefined;
    const profile_id = body.identity?.type === 'profile' ? body.identity.profileId : undefined;
    const ignore_elite = body.kind === 'schedule' ? body.ignoreElite : true;
    const include_current = body.kind === 'schedule' ? body.includeCurrent : false;
    const suggestions_only = body.kind === 'upgrade_suggestions';
    const upgrade_task_payload = body.kind === 'upgrade_suggestions' ? body.upgradeTaskPayload : undefined;
    const history_source = body.kind === 'schedule' ? body.historySource : undefined;

    if (isScenarioComparison && body.identity?.type !== 'profile') {
      return fail({ error: '场景对比实验室必须使用已登录的账号档案。' }, 403);
    }

    if (!operators || !config) {
      scheduleUsage = scheduleFailure('validation_failed');
      return fail({ error: 'Missing operators or config' }, 400);
    }

    const auth = body.identity?.type === 'profile' ? await requireUserSession(req) : null;
    if (body.identity?.type === 'profile' && !auth) {
      scheduleUsage = scheduleFailure('auth_required', { source: 'account_profile' });
      return fail({ error: '请先登录后再提交优化任务。' }, 401);
    }
    let effectiveLicense: LicenseFile;
    let activeProfileId: string | null = null;
    let activeProfile: UserGameAccountRecord | null = null;
    let isPreviewProfile = false;

    if (auth) {
      activeProfileId = typeof profile_id === 'string' && profile_id ? profile_id : auth.activeProfile?.id ?? null;
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
      activeProfile = profile;
      isPreviewProfile = isFreePreviewProfile(profile);
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
        permission: profile.permission,
        issued_at: profile.created_at,
        sig: 'account-' + profile.id,
      };
    } else {
      const licenseCheck = await validateRequestLicense(license);
      if (licenseCheck.ok === false) {
        scheduleUsage = scheduleFailure(licenseCheck.reason_code ?? 'validation_failed', { cdk_status: licenseCheck.cdk_status, source: 'license_file' });
        return fail({ error: licenseCheck.message }, licenseCheck.status);
      }
      checkedCdkRecord = licenseCheck.cdkRecord;
      effectiveLicense = licenseCheck.license;
    }

    const optimizePermission: OptimizeConfigPermission = isPreviewProfile
      ? 'free_preview'
      : getPermissionMode(effectiveLicense);
    const scheduleUsageBase: Partial<ScheduleUsageContext> = {
      permission: optimizePermission,
      profile_id: activeProfileId ?? undefined,
      cdk_status: checkedCdkRecord?.status,
      source: isPreviewProfile ? 'free_preview' : auth ? 'account_profile' : 'license_file',
    };
    scheduleUsage = scheduleFailure('optimizer_runtime_error', scheduleUsageBase);

    if (isScenarioComparison && !['advanced', 'ultimate', 'admin'].includes(optimizePermission)) {
      return fail({ error: '当前套餐不包含场景对比实验室。' }, 403);
    }

    if (checkedCdkRecord && normalizePermissionMode(checkedCdkRecord.permission) === 'advanced') {
      const riskSettings = await getRiskControlSettings();
      let riskCheckedRecord = checkedCdkRecord;

      if (riskSettings.device_risk_enabled) {
        const binding = evaluateClientBindingRisk(riskCheckedRecord, activation_token, req);
        if (!binding.ok) {
          if (!shouldFreezeBindingRisk(binding.event)) {
            const blocked = await recordSoftBlockedRiskEvent(binding.record, binding.event, formatBindingBlockMessage(binding.event));
            scheduleUsage = scheduleFailure('risk_soft_blocked', { ...scheduleUsageBase, cdk_status: blocked.record.status });
            return fail({ error: blocked.message }, 403);
          }
          const frozen = await freezeCdkRecord(binding.record, binding.event.reason, binding.event);
          scheduleUsage = scheduleFailure('risk_frozen', { ...scheduleUsageBase, cdk_status: frozen.status });
          return fail({ error: frozen.freeze_reason || formatRiskFreezeMessage(binding.event.reason) }, 403);
        }
        riskCheckedRecord = binding.record;
      }

      if (riskSettings.operator_data_risk_enabled) {
        const operatorRisk = evaluateOperatorRisk(riskCheckedRecord, operators);
        if (!operatorRisk.ok) {
          const blocked = await recordSoftBlockedRiskEvent(riskCheckedRecord, operatorRisk.event, formatOperatorRiskBlockMessage(operatorRisk.event.reason));
          scheduleUsage = scheduleFailure(blocked.frozen ? 'risk_frozen' : 'risk_soft_blocked', { ...scheduleUsageBase, cdk_status: blocked.record.status });
          return fail({ error: blocked.message }, blocked.frozen ? 403 : 409);
        }
      }

      if (riskCheckedRecord !== checkedCdkRecord) {
        const store = await getCdkRecordStore();
        await store.set('cdk/' + riskCheckedRecord.code_hash + '.json', riskCheckedRecord);
        checkedCdkRecord = riskCheckedRecord;
      }
    }

    const canUseUpgrades = !isPreviewProfile && canUseUpgradeFeatures(effectiveLicense);
    if (!canUseUpgrades && (ignore_elite || include_current || suggestions_only)) {
      scheduleUsage = scheduleFailure('permission_denied', scheduleUsageBase);
      return fail({ error: '当前套餐不包含练度提升建议。' }, 403);
    }

    const configForPermission = isPreviewProfile
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
      return {
        ok: true,
        prepared: {
          ownerKey: 'profile:' + activeProfileId,
          priority: 'analysis',
          priorityValue: 5,
          permission: optimizePermission,
          source: 'scenario_comparison',
          payload: {
            version: 3,
            kind: 'scenario_comparison',
            submittedAt,
            operators,
            effectiveConfig,
            activeProfileId,
            factors: body.factors,
            estimate: buildScenarioComparisonEstimate(expansion.scenarios.length, expansion.variableScenarioCount),
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
    if (isPreviewProfile && activeProfileId && previewWorkspaceForGeneration) {
      const decision = resolveFreeScheduleGenerateDecision(previewWorkspaceForGeneration.free_schedule_entitlement);
      if (!decision.ok) {
        scheduleUsage = scheduleFailure('permission_denied', scheduleUsageBase);
        if (decision.entitlement.locked_at !== previewWorkspaceForGeneration.free_schedule_entitlement?.locked_at
          || decision.entitlement.lock_reason !== previewWorkspaceForGeneration.free_schedule_entitlement?.lock_reason) {
          previewWorkspaceForGeneration = {
            ...previewWorkspaceForGeneration,
            free_schedule_entitlement: decision.entitlement,
            updated_at: new Date().toISOString(),
          };
          await saveWorkspace(previewWorkspaceForGeneration);
        }
        return fail({ error: decision.message, free_schedule_entitlement: decision.entitlement }, decision.status);
      }
      freeScheduleDecision = decision;
    }

    const source: OptimizeJobSource = suggestions_only
      ? 'optimize_suggestions'
      : isPreviewProfile ? 'free_preview' : auth ? 'account_profile' : 'license_file';
    const priority: OptimizeJobPriority = isPreviewProfile ? 'standard' : 'paid';
    const ownerKey = activeProfileId ? 'profile:' + activeProfileId : 'license:' + effectiveLicense.order_hash;
    const estimate = await resolveOptimizeDurationEstimate(estimateBucket);

    return {
      ok: true,
      prepared: {
        ownerKey,
        priority,
        priorityValue: priority === 'paid' ? 10 : 0,
        permission: scheduleUsageBase.permission ?? null,
        source,
        payload: {
          version: 2,
          submittedAt,
          operators,
          effectiveConfig,
          effectiveLicense: { ...effectiveLicense, config: effectiveConfig },
          checkedCdkRecord,
          scheduleUsageBase,
          activeProfileId,
          activeProfile,
          isPreviewProfile,
          previewWorkspaceForGeneration,
          freeScheduleDecision,
          estimate,
          request: { ignore_elite, include_current, suggestions_only, upgrade_task_payload, history_source },
        },
      },
    };
  } catch (err: unknown) {
    console.error('optimize-schedule enqueue error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (!isScenarioComparison) await recordScheduleGenerate(checkedCdkRecord, scheduleUsage, submittedAt);
    return { ok: false, response: jsonResponse({ error: message }, 500) };
  }
}
