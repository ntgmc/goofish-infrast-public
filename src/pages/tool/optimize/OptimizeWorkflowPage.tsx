import { useEffect, useMemo, useRef, useState } from 'react'
import AnnouncementBanner from '../../../components/AnnouncementBanner'
import GuidedTour, { hasCompletedTour, useFirstRunTour, type TourDefinition } from '../../../components/GuidedTour'
import ConfigSection from './ConfigSection'
import { ConfigValidationToast, LicenseSyncPanel } from './feedback'
import OptimizeShell from './OptimizeShell'
import OverviewSection from './OverviewSection'
import PlansSection from './PlansSection'
import ResultSection from './ResultSection'
import ScenarioLabSection from './ScenarioLabSection'
import OptimizationTaskCenterDialog, { OptimizationTaskCenterButton } from './OptimizationTaskCenter'
import { useOptimizationTaskCenter } from './useOptimizationTaskCenter'
import { getProfileAccessLabel } from '../tool-utils'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'
import { copy } from '../../../copy/index'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { apiJson } from '../../../lib/api-client'
import { fetchOptimizationJobSnapshot } from './optimization-api'
import type { OptimizeResult, ReorderCheckResult, WorkspaceResultHistoryItem } from '../../../lib/types'
import SessionLoader from '../../../components/SessionLoader'
import { restoreScenarioComparisonJob } from './scenario-lab/useScenarioComparison'


export default function OptimizeWorkflowPage(props: Props) {
  const { features } = useSiteFeatures()
  const generationDisabledReason = features.schedule_generation ? null : copy.features.schedule_read_only
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const taskCenterButtonRef = useRef<HTMLButtonElement>(null)
  const compactTaskCenterButtonRef = useRef<HTMLButtonElement>(null)
  const taskCenterTriggerRef = useRef(taskCenterButtonRef)
  const taskCenter = useOptimizationTaskCenter(props.profileId, taskCenterOpen)
  const { license, progress, profile, onReset, announcement, redeemedNotice, permission, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, licenseSyncing, licenseSyncStatus, configSyncStatus, retryConfigSave, inlineError, reorderCheckLoading, reorderCheckResult, reorderCheckError, freeScheduleEntitlement, freeScheduleConfirming, freeScheduleConfirmError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk, upgradeLoading, upgradeError, priorityCouponBalance, usePriorityCoupon, setUsePriorityCoupon, itemBalances, profileCapacity, reorderQuota, inventoryLoaded, useTrainingDiagnosisCoupon, setUseTrainingDiagnosisCoupon, useAdditionalRecomputeCoupon, setUseAdditionalRecomputeCoupon, additionalRecomputeCouponEligible, useReorderCheckCoupon, setUseReorderCheckCoupon, refreshInventory, isRestrictedPreview, userCanEditConfig, userCanUseIntermediateAutoConfig, userCanUseUpgradeFeatures, userCanDownloadFullResult, userHasScenarioLabCapability, userCanUseScenarioLab, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, archivedResults, latestWorkspaceResult, freeScheduleGenerateBlockedReason, reorderCheckDisabledReason, configDiffRows, mergedOperators, hasResult, resultIsCurrent, updateConfig, resetConfig, handleApplyScenarioConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleArchiveHistory, handleUnarchiveHistory, handleDeleteHistory, handleReorderCheck, handleCancelReorderCheck, handleOpenReorderCheckResult, handleConfirmFreeSchedule, handleGenerate, handleApplySuggestions, handleDownloadMAA, handleDownloadFullResult, handleUpgradePreviewProfile, declarationDialog } = useOptimizeWorkflow(props)
  const [mainTourSeenAtMount] = useState(() => hasCompletedTour('optimize-overview', 2))
  const initialSectionRef = useRef(section)
  const [sectionChangedAfterMainTour, setSectionChangedAfterMainTour] = useState(false)
  const mainTour = useFirstRunTour({ id: 'optimize-overview', version: 2 })
  const childAutoStartEnabled = mainTourSeenAtMount || sectionChangedAfterMainTour
  const overviewTour = useFirstRunTour({ id: 'optimize-tab-overview', version: 2, autoStart: childAutoStartEnabled && section === 'overview' })
  const plansTour = useFirstRunTour({ id: 'optimize-tab-plans', version: 2, autoStart: childAutoStartEnabled && section === 'plans' })
  const configTour = useFirstRunTour({ id: 'optimize-tab-config', version: 1, autoStart: childAutoStartEnabled && section === 'config' })
  const resultTour = useFirstRunTour({ id: 'optimize-tab-result', version: 1, autoStart: childAutoStartEnabled && section === 'result' && hasResult })
  const labTour = useFirstRunTour({ id: 'optimize-tab-lab', version: 1, autoStart: childAutoStartEnabled && section === 'lab' && userCanUseScenarioLab && features.schedule_generation })

  useEffect(() => {
    if (mainTour.completed && section !== initialSectionRef.current) setSectionChangedAfterMainTour(true)
  }, [mainTour.completed, section])

  const mainTourDefinition = useMemo<TourDefinition>(() => ({
    id: 'optimize-overview',
    version: 2,
    steps: [
      { target: 'optimize-nav-overview', title: copy.optimize.pages_tool_optimize_tour_002, body: copy.optimize.pages_tool_optimize_tour_003 },
      { target: 'optimize-nav-plans', title: copy.optimize.pages_tool_optimize_tour_004, body: copy.optimize.pages_tool_optimize_tour_005 },
      { target: 'optimize-nav-config', title: copy.optimize.pages_tool_optimize_tour_006, body: copy.optimize.pages_tool_optimize_tour_007 },
      { target: 'optimize-nav-result', title: copy.optimize.pages_tool_optimize_tour_008, body: copy.optimize.pages_tool_optimize_tour_009 },
      ...(userCanUseScenarioLab && features.schedule_generation ? [{ target: 'optimize-nav-lab', title: copy.optimize.pages_tool_optimize_tour_010, body: copy.optimize.pages_tool_optimize_tour_011 }] : []),
    ],
  }), [features.schedule_generation, userCanUseScenarioLab])
  const overviewTourDefinition = useMemo<TourDefinition>(() => ({ id: 'optimize-tab-overview', version: 2, steps: [
    { target: 'optimize-overview-status', title: copy.optimize.pages_tool_optimize_tour_012, body: copy.optimize.pages_tool_optimize_tour_013 },
    { target: 'optimize-overview-generate', title: copy.optimize.pages_tool_optimize_tour_014, body: copy.optimize.pages_tool_optimize_tour_015 },
    { target: 'optimize-overview-latest', title: copy.optimize.pages_tool_optimize_tour_016, body: copy.optimize.pages_tool_optimize_tour_017 },
  ] }), [])
  const plansTourDefinition = useMemo<TourDefinition>(() => ({ id: 'optimize-tab-plans', version: 2, steps: [
    { target: 'optimize-plans-save', title: copy.optimize.pages_tool_optimize_tour_018, body: copy.optimize.pages_tool_optimize_tour_019 },
    { target: 'optimize-plans-saved', title: copy.optimize.pages_tool_optimize_tour_020, body: copy.optimize.pages_tool_optimize_tour_021 },
    { target: 'optimize-plans-history', title: copy.optimize.pages_tool_optimize_tour_022, body: copy.optimize.pages_tool_optimize_tour_023 },
  ] }), [])
  const configTourDefinition = useMemo<TourDefinition>(() => ({ id: 'optimize-tab-config', version: 1, steps: [
    { target: 'optimize-config-editor', title: copy.optimize.pages_tool_optimize_tour_024, body: copy.optimize.pages_tool_optimize_tour_025 },
    { target: 'optimize-config-status', title: copy.optimize.pages_tool_optimize_tour_026, body: copy.optimize.pages_tool_optimize_tour_027 },
  ] }), [])
  const resultTourDefinition = useMemo<TourDefinition>(() => ({ id: 'optimize-tab-result', version: 1, steps: [
    { target: 'optimize-result-content', title: copy.optimize.pages_tool_optimize_tour_028, body: copy.optimize.pages_tool_optimize_tour_029 },
    { target: 'optimize-result-actions', title: copy.optimize.pages_tool_optimize_tour_030, body: copy.optimize.pages_tool_optimize_tour_031 },
  ] }), [])
  const labTourDefinition = useMemo<TourDefinition>(() => ({ id: 'optimize-tab-lab', version: 1, steps: [
    { target: 'optimize-lab-factors', title: copy.optimize.pages_tool_optimize_tour_032, body: copy.optimize.pages_tool_optimize_tour_033 },
    { target: 'optimize-lab-run', title: copy.optimize.pages_tool_optimize_tour_034, body: copy.optimize.pages_tool_optimize_tour_035 },
    { target: 'optimize-lab-results', title: copy.optimize.pages_tool_optimize_tour_036, body: copy.optimize.pages_tool_optimize_tour_037 },
  ] }), [])

  const openCurrentTour = () => {
    ({ overview: overviewTour, plans: plansTour, config: configTour, result: resultTour, lab: labTour } as const)[section].start()
  }

  const closeTaskCenter = () => {
    setTaskCenterOpen(false)
    window.setTimeout(() => taskCenterTriggerRef.current.current?.focus(), 0)
  }

  useEffect(() => {
    if (section === 'lab' && inventoryLoaded && !userCanUseScenarioLab) setSection('overview')
  }, [inventoryLoaded, section, setSection, userCanUseScenarioLab])

  if (section === 'lab' && !userHasScenarioLabCapability && !inventoryLoaded) {
    return <SessionLoader label={copy.inventory.loading} />
  }

  return (
      <OptimizeShell
        section={section}
        permissionLabel={getProfileAccessLabel(profile)}
        showScenarioLab={userCanUseScenarioLab && features.schedule_generation}
        badges={{ result: hasResult ? copy.optimize.pages_tool_optimize_OptimizeWorkflowPage_001 : undefined }}
        headerActions={(
          <OptimizationTaskCenterButton
            controller={taskCenter}
            open={taskCenterOpen}
            onOpen={() => {
              taskCenterTriggerRef.current = taskCenterButtonRef
              setTaskCenterOpen(true)
            }}
            buttonRef={taskCenterButtonRef}
          />
        )}
        compactHeaderActions={(
          <OptimizationTaskCenterButton
            controller={taskCenter}
            open={taskCenterOpen}
            onOpen={() => {
              taskCenterTriggerRef.current = compactTaskCenterButtonRef
              setTaskCenterOpen(true)
            }}
            buttonRef={compactTaskCenterButtonRef}
            iconOnly
          />
        )}
        onSectionChange={setSection}
        onOpenTour={openCurrentTour}
        onReset={onReset}
      >
        {configToast && <ConfigValidationToast key={configToast.id} message={configToast.message} />}
        <div className="space-y-4">
          {(licenseSyncing || licenseSyncStatus || announcement || redeemedNotice) && (
            <div className="space-y-3">
              {licenseSyncing && <LicenseSyncPanel />}
  
              {licenseSyncStatus && (
                <div className="tool-alert border-brand-600/30 bg-brand-600/10 text-brand-200" role="status" aria-live="polite">
                  {licenseSyncStatus}
                </div>
              )}
  
              <AnnouncementBanner announcement={announcement} />
  
              {redeemedNotice && (
                <div role="status" aria-live="polite" className="tool-alert tool-alert--warning">
                  {redeemedNotice}
                </div>
              )}
            </div>
          )}

          <OptimizationTaskCenterDialog
            open={taskCenterOpen}
            controller={taskCenter}
            onClose={closeTaskCenter}
            onRetrySchedule={() => {
              closeTaskCenter()
              setSection('overview')
              void handleGenerate()
            }}
            onOpenScenario={() => {
              closeTaskCenter()
              setSection('lab')
            }}
            onOpenReorder={() => {
              closeTaskCenter()
              setSection('overview')
            }}
            onOpenResult={(job) => {
              void (async () => {
                if (job.kind === 'scenario_comparison') {
                  restoreScenarioComparisonJob(props.profileId, job.id)
                  closeTaskCenter()
                  setSection('lab')
                  return
                }
                if (job.kind === 'reorder_check') {
                  const snapshot = await fetchOptimizationJobSnapshot<ReorderCheckResult>(
                    job.id,
                    copy.optimize.pages_tool_optimize_OptimizationTaskCenter_038,
                  )
                  if (snapshot.status !== 'succeeded') throw new Error(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_038)
                  closeTaskCenter()
                  handleOpenReorderCheckResult(snapshot.result)
                  return
                }
                const resultId = job.historyResultId ?? job.id
                const stored = [...resultHistory, ...archivedResults].find((item) => item.id === resultId)
                if (stored) {
                  closeTaskCenter()
                  handleViewHistory(stored)
                  return
                }
                const snapshot = await fetchOptimizationJobSnapshot<OptimizeResult>(
                  job.id,
                  copy.optimize.pages_tool_optimize_OptimizationTaskCenter_038,
                )
                if (snapshot.status !== 'succeeded') throw new Error(copy.optimize.pages_tool_optimize_OptimizationTaskCenter_038)
                const transientHistoryItem: WorkspaceResultHistoryItem = {
                  id: resultId,
                  name: `排班结果 ${new Date(job.timestamps.submittedAt).toLocaleString()}`,
                  created_at: job.timestamps.finishedAt ?? job.timestamps.submittedAt,
                  config: null,
                  result: snapshot.result,
                  operator_count: mergedOperators.filter((operator) => operator.own !== false).length,
                  source: 'generated',
                }
                closeTaskCenter()
                handleViewHistory(transientHistoryItem)
              })().catch((error) => window.alert(error instanceof Error ? error.message : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_038))
            }}
            retryEnabled={features.schedule_generation}
          />
  
          {section === 'overview' && (
            <><MeteredBillingNotice profile={profile} profileId={props.profileId} /><OverviewSection
              activeConfig={activeConfig}
              configChanged={configChanged}
              showConfigDetails={userCanEditConfig}
              operatorCount={license.operators.length}
              configPresetLabel={configPresetLabel}
              validation={configValidation}
              loading={loading}
              syncing={licenseSyncing}
              progress={progress?.mode === 'generate' ? progress : null}
              hasResult={hasResult}
              resultIsCurrent={resultIsCurrent}
              error={inlineError?.scope === 'generate' ? inlineError.message : null}
              priorityCoupon={{ balance: priorityCouponBalance, selected: usePriorityCoupon, onChange: setUsePriorityCoupon }}
              additionalCoupons={[
                ...(!userCanUseUpgradeFeatures && (itemBalances.training_diagnosis_coupon ?? 0) > 0 ? [{
                  id: 'use-training-diagnosis-coupon',
                  label: copy.inventory.training_coupon,
                  help: copy.inventory.training_coupon_help,
                  balance: itemBalances.training_diagnosis_coupon ?? 0,
                  selected: useTrainingDiagnosisCoupon,
                  onChange: setUseTrainingDiagnosisCoupon,
                }] : []),
                ...(additionalRecomputeCouponEligible ? [{
                  id: 'use-additional-recompute-coupon',
                  label: copy.inventory.recompute_coupon,
                  help: copy.inventory.recompute_coupon_help,
                  balance: itemBalances.additional_recompute_coupon ?? 0,
                  selected: useAdditionalRecomputeCoupon,
                  onChange: setUseAdditionalRecomputeCoupon,
                }] : []),
              ]}
              savedConfigCount={savedConfigs.length}
              savedConfigLimit={profileCapacity?.plan_slots.limit}
              resultHistoryCount={resultHistory.length}
              resultHistoryLimit={profileCapacity?.history_slots.limit}
              latestResult={latestWorkspaceResult}
              generationDisabledReason={generationDisabledReason}
              freeSchedule={{
                visible: isRestrictedPreview,
                entitlement: freeScheduleEntitlement,
                generateBlockedReason: generationDisabledReason ?? freeScheduleGenerateBlockedReason,
                confirming: freeScheduleConfirming,
                confirmError: freeScheduleConfirmError,
                onConfirm: handleConfirmFreeSchedule,
              }}
              reorderCheck={{
                visible: isRestrictedPreview,
                disabledReason: generationDisabledReason ?? reorderCheckDisabledReason,
                loading: reorderCheckLoading,
                error: reorderCheckError,
                result: reorderCheckResult,
                onCheck: handleReorderCheck,
                onCancel: handleCancelReorderCheck,
                onGenerate: handleGenerate,
                coupon: {
                  visible: reorderQuota?.remaining === 0 && (itemBalances.reorder_check_coupon ?? 0) > 0,
                  balance: itemBalances.reorder_check_coupon ?? 0,
                  selected: useReorderCheckCoupon,
                  onChange: setUseReorderCheckCoupon,
                },
              }}
              onGenerate={handleGenerate}
              onReset={onReset}
              onOpenPlans={() => setSection('plans')}
              onOpenConfig={() => setSection('config')}
              onViewHistory={handleViewHistory}
              onUseHistoryConfig={handleUseHistoryConfig}
              onDownloadHistory={handleDownloadHistory}
            /></>
          )}
  
          {section === 'plans' && (
            <PlansSection
              activeConfig={activeConfig}
              savedConfigs={savedConfigs}
              resultHistory={resultHistory}
              archivedResults={archivedResults}
              savedConfigLimit={profileCapacity?.plan_slots.limit}
              resultHistoryLimit={profileCapacity?.history_slots.limit}
              archiveLimit={profileCapacity?.archive_slots.limit}
              selectedHistoryId={historyItem?.id ?? null}
              busyAction={workspaceBusyAction}
              notice={workspaceNotice}
              error={workspaceError}
              onSaveCurrent={handleSaveCurrentConfig}
              onUseSavedConfig={handleUseSavedConfig}
              onRenameSavedConfig={handleRenameSavedConfig}
              onDeleteSavedConfig={handleDeleteSavedConfig}
              onViewHistory={handleViewHistory}
              onUseHistoryConfig={handleUseHistoryConfig}
              onDownloadHistory={handleDownloadHistory}
              onArchiveHistory={handleArchiveHistory}
              onUnarchiveHistory={handleUnarchiveHistory}
              onDeleteHistory={handleDeleteHistory}
            />
          )}
  
          {section === 'config' && (
            <div className="space-y-4">
              <ConfigSection
                activeConfig={activeConfig}
                permission={permission}
                userCanEditConfig={userCanEditConfig}
                userCanUseIntermediateAutoConfig={userCanUseIntermediateAutoConfig}
                configChanged={configChanged}
                configPresetLabel={configPresetLabel}
                configValidation={configValidation}
                configSyncStatus={configSyncStatus}
                latestResult={latestWorkspaceResult}
                diffRows={configDiffRows}
                updateConfig={updateConfig}
                resetConfig={resetConfig}
                retryConfigSave={retryConfigSave}
              />
            </div>
          )}
  
          {section === 'result' && (
            <ResultSection
              phase={phase}
              historyItem={historyItem}
              currentResult={currentResult}
              finalResult={finalResult}
              operators={mergedOperators}
              suggestions={suggestions}
              loading={loading}
              progress={progress}
              inlineError={inlineError}
              previewProfile={isRestrictedPreview}
              upgradeCdk={upgradeCdk}
              upgradeLoading={upgradeLoading}
              upgradeError={upgradeError}
              onUpgradeCdkChange={setUpgradeCdk}
              onUpgradePreviewProfile={handleUpgradePreviewProfile}
              onDownloadMAA={handleDownloadMAA}
              onDownloadFullResult={userCanDownloadFullResult ? handleDownloadFullResult : undefined}
              onApplySuggestions={handleApplySuggestions}
              suggestionsReadOnly={!features.schedule_generation}
              onReset={onReset}
            />
          )}

          {section === 'lab' && userCanUseScenarioLab && features.schedule_generation && (
            <ScenarioLabSection
              profileId={props.profileId}
              operators={mergedOperators}
              activeConfig={activeConfig}
              requiresCoupon={!userHasScenarioLabCapability}
              couponBalance={itemBalances.scenario_simulation_coupon ?? 0}
              onInventoryChange={refreshInventory}
              onApplyConfig={handleApplyScenarioConfig}
            />
          )}
        </div>
        <GuidedTour definition={mainTourDefinition} open={mainTour.open} onFinish={mainTour.finish} onSkip={mainTour.skip} />
        <GuidedTour definition={overviewTourDefinition} open={overviewTour.open} onFinish={overviewTour.finish} onSkip={overviewTour.skip} />
        <GuidedTour definition={plansTourDefinition} open={plansTour.open} onFinish={plansTour.finish} onSkip={plansTour.skip} />
        <GuidedTour definition={configTourDefinition} open={configTour.open} onFinish={configTour.finish} onSkip={configTour.skip} />
        <GuidedTour definition={resultTourDefinition} open={resultTour.open} onFinish={resultTour.finish} onSkip={resultTour.skip} />
        {userCanUseScenarioLab && features.schedule_generation && <GuidedTour definition={labTourDefinition} open={labTour.open} onFinish={labTour.finish} onSkip={labTour.skip} />}
        {declarationDialog}
      </OptimizeShell>
    )
}

function MeteredBillingNotice({ profile, profileId }: { profile: Props['profile']; profileId: string }) {
  const [quote, setQuote] = useState<{ charge: string; available: string; sufficient: boolean; tier: number | null } | null>(null)
  useEffect(() => {
    if (profile.kind !== 'metered_personal' && profile.kind !== 'metered_commercial') return
    void apiJson<{ charge: string; available: string; sufficient: boolean; tier: number | null }>(`/api/user/billing/quote?profile_id=${encodeURIComponent(profileId)}&operation=main_schedule`)
      .then(setQuote).catch(() => setQuote(null))
  }, [profile.kind, profileId])
  if (profile.kind !== 'metered_personal' && profile.kind !== 'metered_commercial') return null
  return <div className={`tool-alert mb-4 ${quote?.sufficient === false ? 'tool-alert--error' : 'tool-alert--warning'}`} role="status">
    {quote ? copy.metered.quote.summary(quote.charge, quote.available, quote.tier, quote.sufficient) : copy.metered.quote.loading}
  </div>
}
