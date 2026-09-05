import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react'
import type { Announcement, AuthSuccessResponse, LicenseConfig, LicenseFile, OptimizeResult, UpgradeSuggestion, UserGameAccount, UserWorkspace, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { SystemItemCode } from '../../../lib/inventory-contracts'
import { canEditConfig, canUseScenarioComparison, canUseUpgradeFeatures, getPermissionMode, mergeOperators } from '../../../lib/license'
import { canonicalJson } from '../../../lib/crypto'
import { apiJson } from '../../../lib/api-client'
import { normalizeConfig, validateConfig, normalizeScheduleMode, normalizeDormitoryRule, resolveConfigLayout } from '../../../lib/config'
import { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { describeConfigDiff } from '../../../lib/workspace-history'
import { mergeOptimizeJobProgress, buildOptimizeJobStorageKey, writeActiveOptimizeJob, readActiveOptimizeJob, isActiveOptimizeJob, clearActiveOptimizeJob, clearLegacyOptimizeJobStorage, isOptimizeJobPollCancelled } from './job-progress'
import { isOptimizationJobCancelledError, useOptimizationJob } from './useOptimizationJob'
import type { OptimizePhase, OptimizeSection } from './types'
import { isFreePreviewProfile, isFreePreviewTrialActive } from '../tool-utils'
import type { ConfigSyncStatus, WorkspacePatch } from '../useToolSession'
import { useLicenseSync } from './useLicenseSync'
import { useOptimizeWorkspace } from './useOptimizeWorkspace'
import { buildOptimizeSignature, formatConfigPresetLabel, waitForProgressCompletion, formatOptimizeError, normalizeUpgradeSuggestions, resolveLatestHistoryConfig } from './workflow-utils'
import { usePriorityCoupon as usePriorityCouponState } from './usePriorityCoupon'
import { useInventoryBalances } from './useInventoryBalances'
import { copy } from '../../../copy/index'
import { hasCapability } from '../../../lib/product-catalog'
import { usePersonalUseDeclaration } from '../../../hooks/usePersonalUseDeclaration'
import { upgradeProfileWithCdk } from '../profile-redemption'
import { useResultDownloads } from './useResultDownloads'
import { submitWithMeteredBillingQuote, useMeteredBillingQuote } from './useMeteredBillingQuote'
import { useResultHistoryPagination } from './useResultHistoryPagination'
export interface Props {
  profileId: string;
  profile: UserGameAccount;
  license: LicenseFile;
  workspace: UserWorkspace | null;
  setLicense: (v: LicenseFile) => void;
  eliteOverrides: Record<string, number>;
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
  onLogout: () => void;
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
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([])
  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)
  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)
  const [historyItem, setHistoryItem] = useState<WorkspaceResultHistoryItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScheduleProgressState | null>(null)
  const [phase, setPhase] = useState<OptimizePhase>('idle')
  const setSection = onSectionChange

  const {
    syncing: licenseSyncing,
    status: licenseSyncStatus,
    flushPendingSync: flushPendingLicenseSync,
  } = useLicenseSync(profileId, license.order_hash)

  const [inlineError, setInlineError] = useState<{ scope: 'generate' | 'apply'; message: string } | null>(null)
  const [configToast, setConfigToast] = useState<{ id: number; message: string } | null>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceBusyAction, setWorkspaceBusyAction] = useState<string | null>(null)
  const { quote: billingQuote, loading: billingQuoteLoading, error: billingQuoteError, refresh: loadBillingQuote } = useMeteredBillingQuote(profile.kind, profileId)
  const addOnQuoteRequired = profile.kind === 'metered_personal' || profile.kind === 'metered_commercial'
  const scenarioQuoteRequired = profile.kind === 'metered_personal' || profile.kind === 'metered_commercial'
  const { quote: incrementalBillingQuote, loading: incrementalBillingQuoteLoading, error: incrementalBillingQuoteError, refresh: refreshIncrementalBillingQuote } = useMeteredBillingQuote(profile.kind, profileId, 'incremental_recompute', addOnQuoteRequired)
  const { quote: scenarioBillingQuote, loading: scenarioBillingQuoteLoading, error: scenarioBillingQuoteError, refresh: refreshScenarioBillingQuote } = useMeteredBillingQuote(profile.kind, profileId, 'scenario_comparison', scenarioQuoteRequired)

  const [upgradeCdk, setUpgradeCdk] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const upgradeRequestRef = useRef<{ cdk: string; idempotencyKey: string } | null>(null)
  const handleUpgradeCdkChange = useCallback((value: string) => {
    upgradeRequestRef.current = null
    setUpgradeCdk(value)
  }, [])

  const { balance: priorityCouponBalance, selected: usePriorityCoupon, setSelected: setUsePriorityCoupon, loading: priorityCouponLoading, error: priorityCouponError, refresh: refreshRewardBalance } = usePriorityCouponState(profileId)
  const { balances: itemBalances, capacity: profileCapacity, loaded: inventoryLoaded, loading: inventoryLoading, error: inventoryError, refresh: refreshInventory } = useInventoryBalances(profileId)
  const [useTrainingDiagnosisCoupon, setUseTrainingDiagnosisCoupon] = useState(false)

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
  const userCanExportMaaWithoutCoupon = hasCapability({ kind: profile.kind, permission }, 'export_maa_json')
  const userCanViewFullData = hasCapability({ kind: profile.kind, permission }, 'view_full_data')
  const userCanApplyConfigOverride = true
  const userCanUseUpgradeFeatures = !isRestrictedPreview && canUseUpgradeFeatures(license)
  const userHasScenarioLabCapability = !isRestrictedPreview && canUseScenarioComparison(license)
  const userCanUseScenarioLab = userHasScenarioLabCapability
    || profile.kind === 'metered_personal'
    || profile.kind === 'metered_commercial'
    || (itemBalances.scenario_simulation_coupon ?? 0) > 0

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

  const {
    resultHistory,
    archivedResults,
    resultHistoryHasMore,
    archivedResultsHasMore,
    loadingScope: resultHistoryLoadingScope,
    error: resultHistoryError,
    loadMoreResultHistory,
    loadMoreArchivedResults,
  } = useResultHistoryPagination(profileId, workspace)

  const latestWorkspaceResult = workspace?.latest_result ?? resultHistory[0] ?? null

  const configDiffRows = useMemo(
      () => describeConfigDiff(
        activeConfig,
        resolveLatestHistoryConfig(historyItem, latestWorkspaceResult),
      ),
      [activeConfig, historyItem, latestWorkspaceResult?.id]
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
      setSuggestions([])
      setCurrentResult(null)
      setFinalResult(null)
      setHistoryItem(null)
      setProgress(null)
      setPhase('idle')
      setInlineError(null)
      setLastGeneratedSignature(null)
      upgradeRequestRef.current = null
      setUpgradeCdk('')
      setUpgradeError(null)
      setUseTrainingDiagnosisCoupon(false)
  }, [profileId, workspace?.profile_id])

  useEffect(() => {
    if ((itemBalances.training_diagnosis_coupon ?? 0) < 1) setUseTrainingDiagnosisCoupon(false)
  }, [itemBalances.training_diagnosis_coupon])

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
      draft.layout = resolveConfigLayout(draft)
      const next = normalizeAllowedConfigOverride(draft)
      setConfigOverride(next)
      const nextValidation = validateConfig(next)
      if (nextValidation.ok) {
        clearConfigValidationToast()
      } else {
        showConfigValidationToast(nextValidation.message)
      }
      setInlineError(null)
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

  const refreshWorkspaceResults = useCallback(async () => {
    const data = await apiJson<AuthSuccessResponse>(
      `/api/user/workspace?profile_id=${encodeURIComponent(profileId)}`,
      { fallbackMessage: copy.common.pages_tool_useToolSession_002 },
    )
    if (data.workspace) onWorkspaceUpdated(profileId, data.workspace)
  }, [onWorkspaceUpdated, profileId])

  const { downloadMaaResult, downloadFullResult } = useResultDownloads({
    profileId,
    guardExport: guardGeneratedResultExport,
    canExportMaaWithoutCoupon: userCanExportMaaWithoutCoupon,
    maaExportCouponBalance: itemBalances.maa_export_trial_coupon ?? 0,
    refreshInventory,
    setWorkspaceNotice,
    setWorkspaceError,
    setWorkspaceBusyAction,
  })

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
    onDownloadMaaResult: downloadMaaResult,
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
            setPhase('suggestions')
          }
          setSection('result')
          setLastGeneratedSignature(optimizeSignature)
          await refreshWorkspaceResults().catch((error) => {
            setWorkspaceError(error instanceof Error ? error.message : copy.common.pages_tool_useToolSession_002)
          })
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
    }, [flushPendingLicenseSync, license.order_hash, optimizeSignature, pollOptimizeJob, profileId, refreshInventory, refreshRewardBalance, refreshWorkspaceResults])

  const runOptimize = useCallback(async (includeUpgradeSuggestions: boolean, useItems: SystemItemCode[] = [], billingOperation: 'main_schedule' | 'incremental_recompute' = 'main_schedule', baselineHistoryId?: string) => {
      const quote = billingOperation === 'incremental_recompute' ? incrementalBillingQuote : billingQuote
      const quoteError = billingOperation === 'incremental_recompute' ? incrementalBillingQuoteError : billingQuoteError
      const refreshQuote = billingOperation === 'incremental_recompute' ? refreshIncrementalBillingQuote : loadBillingQuote
      return await submitWithMeteredBillingQuote({
        profileKind: profile.kind, quote, quoteError, refreshQuote,
        requireQuote: billingOperation === 'incremental_recompute' && addOnQuoteRequired,
        submit: async (quote) => runOptimizeJob({
          kind: 'schedule',
          identity: { type: 'profile', profileId },
          operators: mergedOperators,
          config: activeConfig,
          includeUpgradeSuggestions,
          ...(billingOperation !== 'main_schedule' && { billing_operation: billingOperation }),
          ...(baselineHistoryId && { baseline_history_id: baselineHistoryId }),
          ...(useItems.length > 0 && { use_items: useItems }),
          ...(quote && { billing_quote_id: quote.quote_id, pricing_version: quote.pricing_version, accepted_max_points: quote.charge }),
        }, 'generate', copy.optimize.pages_tool_optimize_useOptimizeWorkflow_013),
      })
    }, [activeConfig, addOnQuoteRequired, billingQuote, billingQuoteError, incrementalBillingQuote, incrementalBillingQuoteError, loadBillingQuote, mergedOperators, profile.kind, profileId, refreshIncrementalBillingQuote, runOptimizeJob])

  const executeGeneration = useCallback(async (billingOperation: 'main_schedule' | 'incremental_recompute') => {
      await guardPersonalUseDeclaration('optimization_generate', async () => {
      if (licenseSyncing || loading || optimizeInFlightRef.current) return
      if (billingOperation === 'incremental_recompute' && !latestWorkspaceResult) {
        setInlineError({ scope: 'generate', message: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_024 })
        return
      }
      if (hasResult && lastGeneratedSignature === optimizeSignature) {
        if (billingOperation === 'incremental_recompute') setInlineError({ scope: 'generate', message: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_025 })
        return
      }
      if (configValidationMessage) {
        showConfigValidationToast(configValidationMessage)
        return
      }
      flushConfigSave()
      optimizeInFlightRef.current = true
      setInlineError(null)
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
      if (billingOperation === 'main_schedule') {
        if (usePriorityCoupon && (priorityCouponBalance?.available ?? 0) > 0) selectedItems.push('priority_compute_coupon')
        if (useTrainingDiagnosisCoupon && !userCanUseUpgradeFeatures && (itemBalances.training_diagnosis_coupon ?? 0) > 0) selectedItems.push('training_diagnosis_coupon')
      }
      try {
        const current = await runOptimize(
          userCanUseUpgradeFeatures || selectedItems.includes('training_diagnosis_coupon'),
          selectedItems,
          billingOperation,
          billingOperation === 'incremental_recompute' ? latestWorkspaceResult?.id : undefined,
        )
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
        await refreshWorkspaceResults().catch((error) => {
          setWorkspaceError(error instanceof Error ? error.message : copy.common.pages_tool_useToolSession_002)
        })
      } catch (e) {
        if (!isOptimizationJobCancelledError(e)) {
          setInlineError({ scope: 'generate', message: formatOptimizeError((e as Error).message) })
        }
      } finally {
        setUsePriorityCoupon(false)
        setUseTrainingDiagnosisCoupon(false)
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
      })
    }, [configValidationMessage, flushConfigSave, flushPendingLicenseSync, guardPersonalUseDeclaration, hasResult, itemBalances.training_diagnosis_coupon, lastGeneratedSignature, latestWorkspaceResult, licenseSyncing, loading, optimizeSignature, priorityCouponBalance?.available, refreshInventory, refreshRewardBalance, refreshWorkspaceResults, runOptimize, showConfigValidationToast, usePriorityCoupon, useTrainingDiagnosisCoupon, userCanUseUpgradeFeatures])

  const handleGenerate = useCallback(() => executeGeneration('main_schedule'), [executeGeneration])
  const handleIncrementalRecompute = useCallback(() => executeGeneration('incremental_recompute'), [executeGeneration])

  const handleDownloadMAA = useCallback(() => {
      const resultId = currentResult || finalResult
        ? progress?.historyResultId ?? progress?.jobId
        : historyItem?.id ?? latestWorkspaceResult?.id
      if (!resultId) return
      void downloadMaaResult(resultId)
    }, [currentResult, downloadMaaResult, finalResult, historyItem?.id, latestWorkspaceResult?.id, progress?.historyResultId, progress?.jobId])

  const handleDownloadFullResult = useCallback(() => {
      const resultId = currentResult || finalResult
        ? progress?.historyResultId ?? progress?.jobId
        : historyItem?.id ?? latestWorkspaceResult?.id
      if (!resultId) return
      void downloadFullResult(resultId)
    }, [currentResult, downloadFullResult, finalResult, historyItem?.id, latestWorkspaceResult?.id, progress?.historyResultId, progress?.jobId])

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

  return { license, progress, profile, onReset, announcement, redeemedNotice, permission, billingQuote, billingQuoteLoading, billingQuoteError, refreshBillingQuote: loadBillingQuote, addOnQuoteRequired, incrementalBillingQuote, incrementalBillingQuoteLoading, incrementalBillingQuoteError, refreshIncrementalBillingQuote, scenarioQuoteRequired, scenarioBillingQuote, scenarioBillingQuoteLoading, scenarioBillingQuoteError, refreshScenarioBillingQuote, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, licenseSyncing, licenseSyncStatus, configSyncStatus, retryConfigSave, inlineError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk: handleUpgradeCdkChange, upgradeLoading, upgradeError, priorityCouponBalance, priorityCouponLoading, priorityCouponError, refreshRewardBalance, usePriorityCoupon, setUsePriorityCoupon, itemBalances, profileCapacity, inventoryLoaded, inventoryLoading, inventoryError, useTrainingDiagnosisCoupon, setUseTrainingDiagnosisCoupon, refreshInventory, isPreviewProfile, isRestrictedPreview, userCanEditConfig, userCanUseIntermediateAutoConfig, userCanUseUpgradeFeatures, userCanDownloadFullResult, userCanViewFullData, userHasScenarioLabCapability, userCanUseScenarioLab, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, archivedResults, resultHistoryHasMore, archivedResultsHasMore, resultHistoryLoadingScope, resultHistoryError, loadMoreResultHistory, loadMoreArchivedResults, latestWorkspaceResult, configDiffRows, mergedOperators, hasResult, resultIsCurrent, updateConfig, handleApplyScenarioConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleArchiveHistory, handleUnarchiveHistory, handleDeleteHistory, handleGenerate, handleIncrementalRecompute, handleDownloadMAA, handleDownloadFullResult, handleUpgradePreviewProfile, declarationDialog }
}
