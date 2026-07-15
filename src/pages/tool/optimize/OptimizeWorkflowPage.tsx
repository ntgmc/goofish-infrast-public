import AnnouncementBanner from '../../../components/AnnouncementBanner'
import AdminOperatorPanel from './AdminOperatorPanel'
import ConfigSection from './ConfigSection'
import { ConfigValidationToast, LicenseSyncPanel } from './feedback'
import OptimizeShell from './OptimizeShell'
import OverviewSection from './OverviewSection'
import PlansSection from './PlansSection'
import ResultSection from './ResultSection'
import ScenarioLabSection from './ScenarioLabSection'
import { getProfileAccessLabel } from '../tool-utils'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'
import { copy } from '../../../copy/index'


export default function OptimizeWorkflowPage(props: Props) {
  const { license, progress, profile, onReset, announcement, redeemedNotice, permission, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, operatorUploadStatus, licenseSyncing, licenseSyncStatus, configSyncStatus, retryConfigSave, inlineError, reorderCheckLoading, reorderCheckResult, reorderCheckError, freeScheduleEntitlement, freeScheduleConfirming, freeScheduleConfirmError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk, upgradeLoading, upgradeError, priorityCouponBalance, usePriorityCoupon, setUsePriorityCoupon, operatorFileRef, isRestrictedPreview, userCanReplaceOperators, userCanEditConfig, userCanUseIntermediateAutoConfig, userCanUseScenarioLab, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, latestWorkspaceResult, freeScheduleGenerateBlockedReason, reorderCheckDisabledReason, configDiffRows, mergedOperators, hasResult, resultIsCurrent, handleReplaceOperators, updateConfig, resetConfig, handleApplyScenarioConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleReorderCheck, handleConfirmFreeSchedule, handleGenerate, handleApplySuggestions, handleDownloadMAA, handleUpgradePreviewProfile } = useOptimizeWorkflow(props)

  return (
      <OptimizeShell
        section={section}
        permissionLabel={getProfileAccessLabel(profile)}
        showScenarioLab={userCanUseScenarioLab}
        badges={{
          plans: `${savedConfigs.length}/${resultHistory.length}`,
          result: hasResult ? copy.optimize.pages_tool_optimize_OptimizeWorkflowPage_001 : undefined,
        }}
        onSectionChange={setSection}
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
  
          {section === 'overview' && (
            <OverviewSection
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
              savedConfigCount={savedConfigs.length}
              resultHistoryCount={resultHistory.length}
              latestResult={latestWorkspaceResult}
              freeSchedule={{
                visible: isRestrictedPreview,
                entitlement: freeScheduleEntitlement,
                generateBlockedReason: freeScheduleGenerateBlockedReason,
                confirming: freeScheduleConfirming,
                confirmError: freeScheduleConfirmError,
                onConfirm: handleConfirmFreeSchedule,
              }}
              reorderCheck={{
                visible: isRestrictedPreview,
                disabledReason: reorderCheckDisabledReason,
                loading: reorderCheckLoading,
                error: reorderCheckError,
                result: reorderCheckResult,
                onCheck: handleReorderCheck,
                onGenerate: handleGenerate,
              }}
              onGenerate={handleGenerate}
              onReset={onReset}
              onOpenPlans={() => setSection('plans')}
              onOpenConfig={() => setSection('config')}
              onOpenResult={() => setSection('result')}
              onViewHistory={handleViewHistory}
              onUseHistoryConfig={handleUseHistoryConfig}
              onDownloadHistory={handleDownloadHistory}
            />
          )}
  
          {section === 'plans' && (
            <PlansSection
              activeConfig={activeConfig}
              savedConfigs={savedConfigs}
              resultHistory={resultHistory}
              latestResult={latestWorkspaceResult}
              selectedHistoryId={historyItem?.id ?? null}
              diffRows={configDiffRows}
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
              {userCanReplaceOperators && (
              <AdminOperatorPanel
                operatorCount={license.operators.length}
                status={operatorUploadStatus}
                fileRef={operatorFileRef}
                onReplace={handleReplaceOperators}
              />
            )}
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
              onDownloadMAA={isRestrictedPreview ? undefined : handleDownloadMAA}
              onApplySuggestions={handleApplySuggestions}
              onReset={onReset}
            />
          )}

          {section === 'lab' && userCanUseScenarioLab && (
            <ScenarioLabSection
              profileId={props.profileId}
              operators={mergedOperators}
              activeConfig={activeConfig}
              onApplyConfig={handleApplyScenarioConfig}
            />
          )}
        </div>
      </OptimizeShell>
    )
}
