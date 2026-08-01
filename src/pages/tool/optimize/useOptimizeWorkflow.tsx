import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react'
import type { Announcement, AuthSuccessResponse, FreeScheduleEntitlement, LicenseConfig, LicenseFile, OptimizeResult, ReorderCheckResult, UpgradeSuggestion, UserGameAccount, UserWorkspace, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { CreateOptimizationJobRequest } from '../../../lib/optimization-contracts'
import type { SystemItemCode } from '../../../lib/inventory-contracts'
import { canEditConfig, canUseScenarioComparison, canUseUpgradeFeatures, getPermissionMode, mergeOperators } from '../../../lib/license'
import { canonicalJson } from '../../../lib/crypto'

import { apiJson } from '../../../lib/api-client'

import { normalizeConfig, validateConfig, normalizeScheduleMode, normalizeDormitoryRule } from '../../../lib/config'
import { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { describeConfigDiff } from '../../../lib/workspace-history'
import { mergeOptimizeJobProgress, buildOptimizeJobStorageKey, writeActiveOptimizeJob, readActiveOptimizeJob, isActiveOptimizeJob, clearActiveOptimizeJob, clearLegacyOptimizeJobStorage, isOptimizeJobPollCancelled } from './job-progress'
import { isOptimizationJobCancelledError, useOptimizationJob } from './useOptimizationJob'
import type { OptimizePhase, OptimizeSection } from './types'
import { requestFullResultExport, requestMaaExport, requestReorderCheck } from './optimization-api'
import { isFreePreviewProfile, isFreePreviewTrialActive } from '../tool-utils'
import type { ConfigSyncStatus, WorkspacePatch } from '../useToolSession'
import { useLicenseSync } from './useLicenseSync'
import { useOptimizeWorkspace } from './useOptimizeWorkspace'
import { buildOptimizeSignature, formatConfigPresetLabel, waitForProgressCompletion, formatOptimizeError, getFreeScheduleGenerateBlockedReason, normalizeUpgradeSuggestions } from './workflow-utils'
import { usePriorityCoupon as usePriorityCouponState } from './usePriorityCoupon'
import { useInventoryBalances } from './useInventoryBalances'
import { copy } from '../../../copy/index'
import { hasCapability } from '../../../lib/product-catalog'
import { usePersonalUseDeclaration } from '../../../hooks/usePersonalUseDeclaration'
import { upgradeProfileWithCdk } from '../profile-redemption'

type BillingQuote = { pricing_version: string; charge: string; available: string; sufficient: boolean; tier: number | null; discount_bps: number }


export interface Props {
  profileId: string;
  profile: UserGameAccount;
  license: LicenseFile;
  workspace: UserWorkspace | null;
  setLicense: (v: LicenseFile) => void;
  eliteOverrides: Record<string, number>;
  setEliteOverrides: (v: Record<string, number>) => Promise<void>;
  configOverride: LicenseConfig | null;
  setConfigOverride: (v: LicenseConfig | null) => void;
  configSyncStatus: ConfigSyncStatus;
  flushConfigSave: () => void;
  retryConfigSave: () => void;
  onWorkspacePatch: (patch: WorkspacePatch) => Promise<AuthSuccessResponse | void>;
  onWorkspaceUpdated: (profileId: string, workspace: UserWorkspace) => void;
  section: OptimizeSection;
  onSectionChange: (section: OptimizeSection) => void;
  onReset: () => void;
  announcement: Announcement | null;
  redeemedNotice: string | null;
  onProfileUpgraded: (payload: AuthSuccessResponse) => void;
}

export function useOptimizeWorkflow(props: Props) {
  const {
  profileId,
  profile,
  license,
  workspace,
  eliteOverrides,
  setEliteOverrides,
  configOverride,
  setConfigOverride,
  configSyncStatus,
  flushConfigSave,
  retryConfigSave,
  onWorkspacePatch,
  onWorkspaceUpdated,
  section,
  onSectionChange,
  onReset,
  announcement,
  redeemedNotice,
  onProfileUpgraded,
} = props
  const initialHistoryItem = workspace?.result_history?.[0] ?? null
  const initialSuggestions = normalizeUpgradeSuggestions(initialHistoryItem?.result.upgrade_suggestions)

  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>(initialSuggestions)

  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)

  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)

  const [historyItem, setHistoryItem] = useState<WorkspaceResultHistoryItem | null>(initialHistoryItem)

  const [loading, setLoading] = useState(false)

  const [progress, setProgress] = useState<ScheduleProgressState | null>(null)

  const [phase, setPhase] = useState<OptimizePhase>(initialHistoryItem ? 'history' : 'idle')

  const setSection = onSectionChange

  const {
    syncing: licenseSyncing,
    status: licenseSyncStatus,
    flushPendingSync: flushPendingLicenseSync,
  } = useLicenseSync(profileId, license.order_hash)

  const [inlineError, setInlineError] = useState<{ scope: 'generate' | 'apply'; message: string } | null>(null)

  const [reorderCheckLoading, setReorderCheckLoading] = useState(false)

  const [reorderCheckResult, setReorderCheckResult] = useState<ReorderCheckResult | null>(null)

  const [reorderCheckError, setReorderCheckError] = useState<string | null>(null)

  const [freeScheduleEntitlementOverride, setFreeScheduleEntitlementOverride] = useState<FreeScheduleEntitlement | null>(null)

  const [freeScheduleConfirming, setFreeScheduleConfirming] = useState(false)

  const [freeScheduleConfirmError, setFreeScheduleConfirmError] = useState<string | null>(null)

  const [configToast, setConfigToast] = useState<{ id: number; message: string } | null>(null)

  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)

  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const [workspaceBusyAction, setWorkspaceBusyAction] = useState<string | null>(null)

  const [billingQuote, setBillingQuote] = useState<BillingQuote | null>(null)

  const loadBillingQuote = useCallback(async (): Promise<BillingQuote | null> => {
    if (profile.kind !== 'metered_personal' && profile.kind !== 'metered_commercial') return null
    const quote = await apiJson<BillingQuote>(`/api/user/billing/quote?profile_id=${encodeURIComponent(profileId)}&operation=main_schedule`, { fallbackMessage: copy.metered.quote.load_failed })
    setBillingQuote(quote)
    return quote
  }, [profile.kind, profileId])

  useEffect(() => { void loadBillingQuote().catch(() => setBillingQuote(null)) }, [loadBillingQuote])

  const [upgradeCdk, setUpgradeCdk] = useState('')

  const [upgradeLoading, setUpgradeLoading] = useState(false)

  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const upgradeRequestRef = useRef<{ cdk: string; idempotencyKey: string } | null>(null)

  const handleUpgradeCdkChange = useCallback((value: string) => {
    upgradeRequestRef.current = null
    setUpgradeCdk(value)
  }, [])

  const { balance: priorityCouponBalance, selected: usePriorityCoupon, setSelected: setUsePriorityCoupon, refresh: refreshRewardBalance } = usePriorityCouponState(profileId)
  const { balances: itemBalances, capacity: profileCapacity, reorderQuota, refresh: refreshInventory } = useInventoryBalances(profileId)
  const [useTrainingDiagnosisCoupon, setUseTrainingDiagnosisCoupon] = useState(false)
  const [useAdditionalRecomputeCoupon, setUseAdditionalRecomputeCoupon] = useState(false)
  const [useReorderCheckCoupon, setUseReorderCheckCoupon] = useState(false)

  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string | null>(null)

  const progressRef = useRef<ScheduleProgressState | null>(null)

  const optimizeInFlightRef = useRef(false)

  const optimizeRestoreKeyRef = useRef<string | null>(null)

  const configToastTimerRef = useRef<number | null>(null)

  const configToastIdRef = useRef(0)

  const isPreviewProfile = isFreePreviewProfile(profile)
  const isPreviewTrial = isFreePreviewTrialActive(profile)
  const isRestrictedPreview = isPreviewProfile && !isPreviewTrial
  const { guard: guardPersonalUseDeclaration, declarationDialog } = usePersonalUseDeclaration({
    enabled: isPreviewProfile || profile.kind === 'metered_personal',
    profileId,
    onError: setWorkspaceError,
  })
  const guardGeneratedResultExport = useCallback(async (run: () => void | Promise<void>) => {
    await guardPersonalUseDeclaration('generated_result_export', run)
  }, [guardPersonalUseDeclaration])

  const permission = getPermissionMode(license)

  const userCanEditConfig = canEditConfig(license)

  const userCanUseIntermediateAutoConfig = isPreviewProfile || hasCapability({ permission }, 'use_intermediate_auto_config')

  const userCanDownloadFullResult = hasCapability({ kind: profile.kind, permission }, 'export_full_result_json')

  const userCanApplyConfigOverride = true

  const userCanUseUpgradeFeatures = !isRestrictedPreview && canUseUpgradeFeatures(license)
  const userHasScenarioLabCapability = !isRestrictedPreview && canUseScenarioComparison(license)
  const userCanUseScenarioLab = userHasScenarioLabCapability || (itemBalances.scenario_simulation_coupon ?? 0) > 0

  useEffect(() => {
      progressRef.current = progress
    }, [progress])

  const activeConfig = useMemo(
      () => normalizeConfig(configOverride ?? license.config),
      [configOverride, license.config]
    )

  const baseConfig = useMemo(() => normalizeConfig(license.config), [license.config])

  const configChanged = useMemo(
      () => canonicalJson(activeConfig) !== canonicalJson(baseConfig),
      [activeConfig, baseConfig]
    )

  const configValidation = useMemo(() => validateConfig(activeConfig), [activeConfig])

  const configValidationMessage = configValidation.ok === false ? configValidation.message : null

  const configPresetLabel = useMemo(() => formatConfigPresetLabel(activeConfig), [activeConfig])

  const savedConfigs = workspace?.saved_configs ?? []

  const resultHistory = workspace?.result_history ?? []

  const latestWorkspaceResult = resultHistory[0] ?? null

  const freeScheduleEntitlement =
      freeScheduleEntitlementOverride
      ?? finalResult?.preview_limit?.free_schedule_entitlement
      ?? reorderCheckResult?.free_schedule_entitlement
      ?? workspace?.free_schedule_entitlement
      ?? null

  const freeScheduleGenerateBlockedReason = useMemo(
      () => getFreeScheduleGenerateBlockedReason(isRestrictedPreview, freeScheduleEntitlement),
      [freeScheduleEntitlement, isRestrictedPreview],
    )

  const additionalRecomputeCouponEligible = useMemo(() => {
      if (!isRestrictedPreview || freeScheduleEntitlement?.lock_reason !== 'revision_limit') return false
      if (freeScheduleEntitlement.confirmed_at || !freeScheduleEntitlement.first_generated_at) return false
      const windowEndsAt = Date.parse(freeScheduleEntitlement.first_generated_at) + freeScheduleEntitlement.revision_window_hours * 60 * 60_000
      return Date.now() < windowEndsAt && (itemBalances.additional_recompute_coupon ?? 0) > 0
    }, [freeScheduleEntitlement, isRestrictedPreview, itemBalances.additional_recompute_coupon])

  const effectiveFreeScheduleGenerateBlockedReason = useAdditionalRecomputeCoupon && additionalRecomputeCouponEligible
    ? null
    : freeScheduleGenerateBlockedReason

  const reorderCheckDisabledReason = useMemo(() => {
      if (!isRestrictedPreview) return null
      if (!profile.skland_binding) return copy.optimize.pages_tool_optimize_useOptimizeWorkflow_001
      if (!latestWorkspaceResult) return copy.optimize.pages_tool_optimize_useOptimizeWorkflow_002
      if (licenseSyncing) return copy.optimize.pages_tool_optimize_useOptimizeWorkflow_003
      if (configValidationMessage) return configValidationMessage
      if (reorderQuota?.remaining === 0 && (itemBalances.reorder_check_coupon ?? 0) < 1) return copy.inventory.reorder_coupon_unavailable
      if (reorderQuota?.remaining === 0 && !useReorderCheckCoupon) return copy.inventory.reorder_coupon_required
      return null
    }, [configValidationMessage, isRestrictedPreview, itemBalances.reorder_check_coupon, latestWorkspaceResult, licenseSyncing, profile.skland_binding, reorderQuota?.remaining, useReorderCheckCoupon])

  const configDiffRows = useMemo(
      () => describeConfigDiff(activeConfig, latestWorkspaceResult?.config ?? null),
      [activeConfig, latestWorkspaceResult]
    )

  const normalizeAllowedConfigOverride = useCallback((nextConfig: LicenseConfig): LicenseConfig => {
      const next = normalizeConfig(nextConfig)
      if (userCanEditConfig) return next
  
      const limited = normalizeConfig(baseConfig)
      limited.schedule_mode = normalizeScheduleMode(next.schedule_mode)
      limited.dormitory_rule = normalizeDormitoryRule(next.dormitory_rule)
      if (limited.schedule_mode !== 'rotation' && userCanUseIntermediateAutoConfig && (next.auto_balance_source === 'intermediate_inventory' || next.auto_balance_source === 'limited_config')) {
        limited.intermediate_inventory = next.intermediate_inventory
        limited.auto_balance_source = next.auto_balance_source
        limited.drones = next.drones
      }
  
      return limited
    }, [baseConfig, userCanEditConfig, userCanUseIntermediateAutoConfig])

  const clearConfigValidationToast = useCallback(() => {
      if (configToastTimerRef.current !== null) {
        window.clearTimeout(configToastTimerRef.current)
        configToastTimerRef.current = null
      }
      setConfigToast(null)
    }, [])

  const showConfigValidationToast = useCallback((message: string) => {
      if (configToastTimerRef.current !== null) {
        window.clearTimeout(configToastTimerRef.current)
      }
      configToastIdRef.current += 1
      setConfigToast({ id: configToastIdRef.current, message })
      configToastTimerRef.current = window.setTimeout(() => {
        setConfigToast(null)
        configToastTimerRef.current = null
      }, 4200)
    }, [])

  useEffect(() => {
      return () => {
        if (configToastTimerRef.current !== null) {
          window.clearTimeout(configToastTimerRef.current)
        }
      }
    }, [])

  useEffect(() => {
      const nextHistoryItem = workspace?.result_history?.[0] ?? null
      setSuggestions(normalizeUpgradeSuggestions(nextHistoryItem?.result.upgrade_suggestions))
      setCurrentResult(null)
      setFinalResult(null)
      setHistoryItem(nextHistoryItem)
      setProgress(null)
      setPhase(nextHistoryItem ? 'history' : 'idle')
      setInlineError(null)
      setReorderCheckLoading(false)
      setReorderCheckResult(null)
      setReorderCheckError(null)
      setFreeScheduleEntitlementOverride(null)
      setFreeScheduleConfirming(false)
      setFreeScheduleConfirmError(null)
      setLastGeneratedSignature(null)
      upgradeRequestRef.current = null
      setUpgradeCdk('')
      setUpgradeError(null)
      setUseTrainingDiagnosisCoupon(false)
      setUseAdditionalRecomputeCoupon(false)
      setUseReorderCheckCoupon(false)
  }, [profileId, workspace?.profile_id])

  useEffect(() => {
    if ((itemBalances.training_diagnosis_coupon ?? 0) < 1) setUseTrainingDiagnosisCoupon(false)
    if (!additionalRecomputeCouponEligible) setUseAdditionalRecomputeCoupon(false)
    if (reorderQuota?.remaining !== 0 || (itemBalances.reorder_check_coupon ?? 0) < 1) setUseReorderCheckCoupon(false)
  }, [additionalRecomputeCouponEligible, itemBalances.reorder_check_coupon, itemBalances.training_diagnosis_coupon, reorderQuota?.remaining])

  const mergedOperators = useMemo(
      () => mergeOperators(license.operators, eliteOverrides),
      [license.operators, eliteOverrides]
    )

  const optimizeSignature = useMemo(
      () => buildOptimizeSignature(mergedOperators, activeConfig),
      [activeConfig, mergedOperators]
    )

  const hasResult = Boolean(finalResult || currentResult || historyItem)

  const resultIsCurrent = hasResult && lastGeneratedSignature === optimizeSignature

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
      if (!userCanApplyConfigOverride) return
      const draft = normalizeConfig(activeConfig)
      mutate(draft)
      draft.layout = `${draft.trading_stations_count}-${draft.manufacturing_stations_count}-3`
      const next = normalizeAllowedConfigOverride(draft)
      setConfigOverride(next)
      const nextValidation = validateConfig(next)
      if (nextValidation.ok) {
        clearConfigValidationToast()
      } else {
        showConfigValidationToast(nextValidation.message)
      }
      setInlineError(null)
      setReorderCheckResult(null)
      setReorderCheckError(null)
    }, [activeConfig, clearConfigValidationToast, normalizeAllowedConfigOverride, setConfigOverride, showConfigValidationToast, userCanApplyConfigOverride])

  const handleApplyScenarioConfig = useCallback((scenarioConfig: LicenseConfig) => {
    updateConfig((draft) => {
      for (const key of Object.keys(draft)) delete (draft as Record<string, unknown>)[key]
      Object.assign(draft, JSON.parse(JSON.stringify(scenarioConfig)) as LicenseConfig)
    })
    configToastIdRef.current += 1
    setConfigToast({ id: configToastIdRef.current, message: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_010 })
    setSection('config')
  }, [updateConfig])

  const resetConfig = useCallback(() => {
      setConfigOverride(null)
      clearConfigValidationToast()
      setInlineError(null)
      setReorderCheckResult(null)
      setReorderCheckError(null)
    }, [clearConfigValidationToast, setConfigOverride])

  const {
    handleSaveCurrentConfig,
    handleRenameSavedConfig,
    handleDeleteSavedConfig,
    handleUseSavedConfig,
    handleViewHistory,
    handleUseHistoryConfig,
    handleDownloadHistory,
    handleArchiveHistory,
    handleUnarchiveHistory,
    handleDeleteHistory,
  } = useOptimizeWorkspace({
    profileId,
    activeConfig,
    normalizeAllowedConfigOverride,
    onWorkspacePatch,
    onWorkspaceUpdated,
    setConfigOverride,
    setCurrentResult,
    setFinalResult,
    setHistoryItem,
    setSuggestions,
    setPhase,
    setLastGeneratedSignature,
    setInlineError,
    setWorkspaceNotice,
    setWorkspaceError,
    setWorkspaceBusyAction,
    setSection,
    guardGeneratedResultExport,
  })

  const {
      pollOptimizationJob: pollOptimizeJob,
      runOptimizationJob: runOptimizeJob,
    } = useOptimizationJob({
      profileId,
      orderHash: license.order_hash,
      signature: optimizeSignature,
      progressRef,
      setProgress,
    })

  useEffect(() => {
      if (optimizeInFlightRef.current) return
      const modes: ScheduleProgressState['mode'][] = ['apply', 'generate']
      const active = modes
        .map((mode) => {
          const storageKey = buildOptimizeJobStorageKey(profileId, license.order_hash, optimizeSignature, mode)
          clearLegacyOptimizeJobStorage(profileId, license.order_hash, optimizeSignature, mode)
          return { mode, storageKey, entry: readActiveOptimizeJob(storageKey) }
        })
        .find(({ entry }) => isActiveOptimizeJob(entry?.job ?? null))
      if (!active || !active.entry || !isActiveOptimizeJob(active.entry.job)) return
      if (optimizeRestoreKeyRef.current === active.storageKey) return
      const activeJob = active.entry.job
      const restoredProgress = mergeOptimizeJobProgress(active.entry.progress ?? null, activeJob, active.mode, Date.now())
  
      optimizeRestoreKeyRef.current = active.storageKey
      optimizeInFlightRef.current = true
      setLoading(true)
      setInlineError(null)
      progressRef.current = restoredProgress
      setProgress(restoredProgress)
      writeActiveOptimizeJob(active.storageKey, activeJob, restoredProgress)
  
      let cancelled = false
      void (async () => {
        let completed = false
        try {
          const result = await pollOptimizeJob(
            activeJob,
            active.storageKey,
            active.mode,
            active.mode === 'apply' ? copy.optimize.pages_tool_optimize_useOptimizeWorkflow_011 : copy.optimize.pages_tool_optimize_useOptimizeWorkflow_012,
            () => cancelled,
          )
          if (cancelled) return
          completed = true
          setProgress((current) => ({
            ...current,
            mode: active.mode,
            startedAt: current?.startedAt ?? (Date.parse(activeJob.submitted_at) || Date.now()),
            completedAt: Date.now(),
            estimatedRemainingMs: 0,
            estimatePhase: 'completed',
            calculationStage: 'completed',
            upgradeSuggestionsStatus: result.upgrade_suggestions_status,
            estimateAdjustment: undefined,
            lastUpdatedAt: Date.now(),
          }))
          await waitForProgressCompletion()
          if (active.mode === 'apply') {
            setFinalResult(result)
            setPhase('final')
          } else {
            const current = result
            setCurrentResult(current)
            setFinalResult(null)
            setHistoryItem(null)
            setSuggestions(normalizeUpgradeSuggestions(result.upgrade_suggestions))
            if (current.preview_limit?.free_schedule_entitlement) {
              setFreeScheduleEntitlementOverride(current.preview_limit.free_schedule_entitlement)
            }
            setPhase('suggestions')
          }
          setSection('result')
          setLastGeneratedSignature(optimizeSignature)
        } catch (error) {
          if (!cancelled && !isOptimizeJobPollCancelled(error)) {
            clearActiveOptimizeJob(active.storageKey)
            if (!isOptimizationJobCancelledError(error)) {
              setInlineError({
                scope: active.mode === 'apply' ? 'apply' : 'generate',
                message: formatOptimizeError(error instanceof Error ? error.message : String(error)),
              })
            }
          }
        } finally {
          if (!cancelled) {
            await Promise.all([refreshRewardBalance(), refreshInventory()])
            optimizeInFlightRef.current = false
            setLoading(false)
            flushPendingLicenseSync()
            if (!completed && progressRef.current?.estimatePhase !== 'cancelled'
              && progressRef.current?.billing?.status !== 'released') {
              progressRef.current = null
              setProgress(null)
            }
          }
        }
      })()
  
      return () => {
        cancelled = true
        optimizeInFlightRef.current = false
      }
    }, [flushPendingLicenseSync, license.order_hash, optimizeSignature, pollOptimizeJob, profileId, refreshInventory, refreshRewardBalance])

  const runOptimize = useCallback(async (includeUpgradeSuggestions: boolean, useItems: SystemItemCode[] = []) => {
      const quote = await loadBillingQuote()
      const payload: CreateOptimizationJobRequest = {
        kind: 'schedule',
        identity: { type: 'profile', profileId },
        operators: mergedOperators,
        config: activeConfig,
        includeUpgradeSuggestions,
        ...(useItems.length > 0 && { use_items: useItems }),
        ...(quote && { pricing_version: quote.pricing_version, accepted_max_points: quote.charge }),
      }
      return await runOptimizeJob(payload, 'generate', copy.optimize.pages_tool_optimize_useOptimizeWorkflow_013)
    }, [activeConfig, loadBillingQuote, mergedOperators, profileId, runOptimizeJob])

  const handleReorderCheck = useCallback(async () => {
      if (!isRestrictedPreview || reorderCheckLoading || loading) return
      if (reorderCheckDisabledReason) {
        setReorderCheckError(reorderCheckDisabledReason)
        return
      }
      if (!latestWorkspaceResult) return
      setReorderCheckLoading(true)
      setReorderCheckResult(null)
      setReorderCheckError(null)
      try {
        const data = await requestReorderCheck({
          profileId,
          config: activeConfig,
          baselineHistoryId: latestWorkspaceResult.id,
          ...(useReorderCheckCoupon && { use_items: ['reorder_check_coupon'] }),
        }, copy.optimize.pages_tool_optimize_useOptimizeWorkflow_015)
        setReorderCheckResult(data)
        if (data.free_schedule_entitlement) {
          setFreeScheduleEntitlementOverride(data.free_schedule_entitlement)
        }
      } catch (error) {
        setReorderCheckError((error as Error).message)
      } finally {
        setReorderCheckLoading(false)
        setUseReorderCheckCoupon(false)
        await refreshInventory()
      }
    }, [activeConfig, isRestrictedPreview, latestWorkspaceResult, loading, profileId, refreshInventory, reorderCheckDisabledReason, reorderCheckLoading, useReorderCheckCoupon])

  const handleConfirmFreeSchedule = useCallback(async () => {
      if (!isPreviewProfile || freeScheduleConfirming || !latestWorkspaceResult) return
      setFreeScheduleConfirming(true)
      setFreeScheduleConfirmError(null)
      try {
        const data = await apiJson<AuthSuccessResponse>('/api/user/workspace/free-schedule/confirm', {
          method: 'POST',
          json: {
            profile_id: profileId,
            result_history_id: latestWorkspaceResult.id,
          },
          fallbackMessage: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_016,
        })
        setFreeScheduleEntitlementOverride(data.workspace?.free_schedule_entitlement ?? null)
      } catch (error) {
        setFreeScheduleConfirmError((error as Error).message)
      } finally {
        setFreeScheduleConfirming(false)
      }
    }, [freeScheduleConfirming, isPreviewProfile, latestWorkspaceResult, profileId])

  const handleGenerate = useCallback(async () => {
      if (licenseSyncing || loading || optimizeInFlightRef.current) return
      if (hasResult && lastGeneratedSignature === optimizeSignature) return
      if (effectiveFreeScheduleGenerateBlockedReason) {
        setInlineError({ scope: 'generate', message: effectiveFreeScheduleGenerateBlockedReason })
        return
      }
      if (configValidationMessage) {
        showConfigValidationToast(configValidationMessage)
        return
      }
      flushConfigSave()
      optimizeInFlightRef.current = true
      setInlineError(null)
      setReorderCheckResult(null)
      setReorderCheckError(null)
      setHistoryItem(null)
      setPhase('idle')
      setLoading(true)
      const startedAt = Date.now()
      const initialProgress: ScheduleProgressState = {
        mode: 'generate',
        startedAt,
        lastUpdatedAt: Date.now(),
        upgradeSuggestionsRequested: userCanUseUpgradeFeatures,
        upgradeSuggestionsAllowed: userCanUseUpgradeFeatures,
      }
      progressRef.current = initialProgress
      setProgress(initialProgress)
      let completed = false
      const selectedItems: SystemItemCode[] = []
      if (usePriorityCoupon && (priorityCouponBalance?.available ?? 0) > 0) selectedItems.push('priority_compute_coupon')
      if (useTrainingDiagnosisCoupon && !userCanUseUpgradeFeatures && (itemBalances.training_diagnosis_coupon ?? 0) > 0) selectedItems.push('training_diagnosis_coupon')
      if (useAdditionalRecomputeCoupon && additionalRecomputeCouponEligible) selectedItems.push('additional_recompute_coupon')
      try {
        const current = await runOptimize(userCanUseUpgradeFeatures || selectedItems.includes('training_diagnosis_coupon'), selectedItems)
        if (current.preview_limit?.free_schedule_entitlement) {
          setFreeScheduleEntitlementOverride(current.preview_limit.free_schedule_entitlement)
        }
        setCurrentResult(current)
        const upgradeList = normalizeUpgradeSuggestions(current.upgrade_suggestions)
        completed = true
        setProgress((progressState) => ({
          ...progressState,
          mode: 'generate',
          startedAt: progressState?.startedAt ?? startedAt,
          completedAt: Date.now(),
          estimatedRemainingMs: 0,
          estimatePhase: 'completed',
          calculationStage: 'completed',
          upgradeSuggestionsStatus: current.upgrade_suggestions_status,
          lastUpdatedAt: Date.now(),
        }))
        await waitForProgressCompletion()
        setSuggestions(upgradeList)
        setPhase('suggestions')
        setSection('result')
        setLastGeneratedSignature(optimizeSignature)
      } catch (e) {
        if (!isOptimizationJobCancelledError(e)) {
          setInlineError({ scope: 'generate', message: formatOptimizeError((e as Error).message) })
        }
      } finally {
        setUsePriorityCoupon(false)
        setUseTrainingDiagnosisCoupon(false)
        setUseAdditionalRecomputeCoupon(false)
        await Promise.all([refreshRewardBalance(), refreshInventory()])
        optimizeInFlightRef.current = false
        setLoading(false)
        flushPendingLicenseSync()
        if (!completed && progressRef.current?.estimatePhase !== 'cancelled'
          && progressRef.current?.billing?.status !== 'released') {
          progressRef.current = null
          setProgress(null)
        }
      }
    }, [additionalRecomputeCouponEligible, configValidationMessage, effectiveFreeScheduleGenerateBlockedReason, flushConfigSave, flushPendingLicenseSync, hasResult, itemBalances.training_diagnosis_coupon, lastGeneratedSignature, licenseSyncing, loading, optimizeSignature, priorityCouponBalance?.available, refreshInventory, refreshRewardBalance, runOptimize, showConfigValidationToast, useAdditionalRecomputeCoupon, usePriorityCoupon, useTrainingDiagnosisCoupon, userCanUseUpgradeFeatures])

  const handleApplySuggestions = useCallback(async (selectedIds: string[]) => {
      if (loading || optimizeInFlightRef.current) return
      if (!resultIsCurrent) {
        setInlineError({ scope: 'apply', message: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_021 })
        return
      }
      optimizeInFlightRef.current = true
      setInlineError(null)
      const startedAt = Date.now()
      const initialProgress: ScheduleProgressState = {
        mode: 'apply',
        startedAt,
        lastUpdatedAt: Date.now(),
        upgradeSuggestionsRequested: false,
        upgradeSuggestionsAllowed: false,
      }
      progressRef.current = initialProgress
      setProgress(initialProgress)
      let completed = false
      const selectedSet = new Set(selectedIds)
      const newOverrides = { ...eliteOverrides }
      for (const s of suggestions) {
        if (s.type === 'single' && s.id && selectedSet.has(s.id) && s.target_elite !== undefined) {
          newOverrides[s.id] = s.target_elite
        }
        if (s.type === 'bundle' && s.id && s.ops && selectedSet.has(s.id)) {
          for (const op of s.ops) {
            if (op.id && op.target_elite !== undefined) {
              newOverrides[op.id] = op.target_elite
            }
          }
        }
      }
      setLoading(true)
      try {
        await setEliteOverrides(newOverrides)
        const quote = await loadBillingQuote()
        const applyPayload: CreateOptimizationJobRequest = {
          kind: 'schedule',
          identity: { type: 'profile', profileId },
          operators: mergeOperators(license.operators, newOverrides),
          config: activeConfig,
          includeUpgradeSuggestions: false,
          historySource: 'applied_suggestions',
          ...(quote && { pricing_version: quote.pricing_version, accepted_max_points: quote.charge }),
        }
        const data = await runOptimizeJob(applyPayload, 'apply', copy.optimize.pages_tool_optimize_useOptimizeWorkflow_022)
        completed = true
        setProgress((current) => ({
          ...current,
          mode: 'apply',
          startedAt: current?.startedAt ?? startedAt,
          completedAt: Date.now(),
          estimatedRemainingMs: 0,
          estimatePhase: 'completed',
          calculationStage: 'completed',
          upgradeSuggestionsStatus: data.upgrade_suggestions_status,
          estimateAdjustment: undefined,
          lastUpdatedAt: Date.now(),
        }))
        await waitForProgressCompletion()
        setFinalResult(data)
        setPhase('final')
        setSection('result')
        setLastGeneratedSignature(buildOptimizeSignature(mergeOperators(license.operators, newOverrides), activeConfig))
      } catch (e) {
        if (!isOptimizationJobCancelledError(e)) {
          setInlineError({ scope: 'apply', message: formatOptimizeError((e as Error).message) })
        }
      } finally {
        optimizeInFlightRef.current = false
        setLoading(false)
        if (!completed && progressRef.current?.estimatePhase !== 'cancelled'
          && progressRef.current?.billing?.status !== 'released') {
          progressRef.current = null
          setProgress(null)
        }
      }
    }, [activeConfig, eliteOverrides, loadBillingQuote, loading, resultIsCurrent, runOptimizeJob, suggestions, license, profileId, setEliteOverrides])

  const handleDownloadMAA = useCallback(() => {
      const resultId = currentResult || finalResult
        ? progress?.jobId
        : historyItem?.id ?? latestWorkspaceResult?.id
      if (!resultId) return
      void guardGeneratedResultExport(async () => {
        await requestMaaExport(profileId, resultId)
      }).catch((error) => setWorkspaceError((error as Error).message))
    }, [currentResult, finalResult, guardGeneratedResultExport, historyItem?.id, latestWorkspaceResult?.id, profileId, progress?.jobId, setWorkspaceError])

  const handleDownloadFullResult = useCallback(() => {
      const resultId = currentResult || finalResult
        ? progress?.jobId
        : historyItem?.id ?? latestWorkspaceResult?.id
      if (!resultId) return
      void guardGeneratedResultExport(async () => {
        await requestFullResultExport(profileId, resultId)
      }).catch((error) => setWorkspaceError((error as Error).message))
    }, [currentResult, finalResult, guardGeneratedResultExport, historyItem?.id, latestWorkspaceResult?.id, profileId, progress?.jobId, setWorkspaceError])

  const handleUpgradePreviewProfile = useCallback(async (event: FormEvent) => {
      event.preventDefault()
      if (!isPreviewProfile || upgradeLoading) return
      const normalizedCdk = upgradeCdk.trim()
      const pendingRequest = upgradeRequestRef.current?.cdk === normalizedCdk
        ? upgradeRequestRef.current
        : { cdk: normalizedCdk, idempotencyKey: crypto.randomUUID() }
      upgradeRequestRef.current = pendingRequest
      setUpgradeLoading(true)
      setUpgradeError(null)
      try {
        const data = await upgradeProfileWithCdk({
          profileId,
          cdk: upgradeCdk,
          idempotencyKey: pendingRequest.idempotencyKey,
          fallbackMessage: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_023,
        })
        upgradeRequestRef.current = null
        setUpgradeCdk('')
        onProfileUpgraded(data)
      } catch (error) {
        setUpgradeError((error as Error).message)
      } finally {
        setUpgradeLoading(false)
      }
    }, [isPreviewProfile, onProfileUpgraded, profileId, upgradeCdk, upgradeLoading])

  return { license, progress, profile, onReset, announcement, redeemedNotice, permission, billingQuote, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, licenseSyncing, licenseSyncStatus, configSyncStatus, retryConfigSave, inlineError, reorderCheckLoading, reorderCheckResult, reorderCheckError, freeScheduleEntitlement, freeScheduleConfirming, freeScheduleConfirmError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk: handleUpgradeCdkChange, upgradeLoading, upgradeError, priorityCouponBalance, usePriorityCoupon, setUsePriorityCoupon, itemBalances, profileCapacity, reorderQuota, useTrainingDiagnosisCoupon, setUseTrainingDiagnosisCoupon, useAdditionalRecomputeCoupon, setUseAdditionalRecomputeCoupon, additionalRecomputeCouponEligible, useReorderCheckCoupon, setUseReorderCheckCoupon, refreshInventory, isPreviewProfile, isRestrictedPreview, userCanEditConfig, userCanUseIntermediateAutoConfig, userCanUseUpgradeFeatures, userCanDownloadFullResult, userHasScenarioLabCapability, userCanUseScenarioLab, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, archivedResults: workspace?.archived_results ?? [], latestWorkspaceResult, freeScheduleGenerateBlockedReason: effectiveFreeScheduleGenerateBlockedReason, reorderCheckDisabledReason, configDiffRows, mergedOperators, hasResult, resultIsCurrent, updateConfig, resetConfig, handleApplyScenarioConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleArchiveHistory, handleUnarchiveHistory, handleDeleteHistory, handleReorderCheck, handleConfirmFreeSchedule, handleGenerate, handleApplySuggestions, handleDownloadMAA, handleDownloadFullResult, handleUpgradePreviewProfile, declarationDialog }
}
