import AnnouncementBanner from '../../../components/AnnouncementBanner'
import AdminOperatorPanel from './AdminOperatorPanel'
import ConfigSection from './ConfigSection'
import { ConfigValidationToast, LicenseSyncPanel } from './feedback'
import OptimizeShell from './OptimizeShell'
import OverviewSection from './OverviewSection'
import PlansSection from './PlansSection'
import ResultSection from './ResultSection'
import { getProfileAccessLabel } from '../tool-utils'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'

export default function OptimizeWorkflowPage(props: Props) {
  const { license, progress, profile, onReset, announcement, redeemedNotice, permission, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, operatorUploadStatus, licenseSyncing, licenseSyncStatus, inlineError, reorderCheckLoading, reorderCheckResult, reorderCheckError, freeScheduleEntitlement, freeScheduleConfirming, freeScheduleConfirmError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk, upgradeLoading, upgradeError, operatorFileRef, isPreviewProfile, userCanReplaceOperators, userCanEditConfig, userCanUseIntermediateAutoConfig, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, latestWorkspaceResult, freeScheduleGenerateBlockedReason, reorderCheckDisabledReason, configDiffRows, mergedOperators, hasResult, resultIsCurrent, handleReplaceOperators, updateConfig, resetConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleReorderCheck, handleConfirmFreeSchedule, handleGenerate, handleApplySuggestions, handleDownloadMAA, handleUpgradePreviewProfile } = useOptimizeWorkflow(props)

  return (
      <OptimizeShell
        section={section}
        permissionLabel={getProfileAccessLabel(profile)}
        badges={{
          plans: `${savedConfigs.length}/${resultHistory.length}`,
          result: hasResult ? '有结果' : undefined,
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
                <div className="rounded-lg border border-brand-600/30 bg-brand-600/10 px-4 py-3 text-sm leading-6 text-brand-300">
                  {licenseSyncStatus}
                </div>
              )}
  
              <AnnouncementBanner announcement={announcement} />
  
              {redeemedNotice && (
                <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
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
              savedConfigCount={savedConfigs.length}
              resultHistoryCount={resultHistory.length}
              latestResult={latestWorkspaceResult}
              freeSchedule={{
                visible: isPreviewProfile,
                entitlement: freeScheduleEntitlement,
                generateBlockedReason: freeScheduleGenerateBlockedReason,
                confirming: freeScheduleConfirming,
                confirmError: freeScheduleConfirmError,
                onConfirm: handleConfirmFreeSchedule,
              }}
              reorderCheck={{
                visible: isPreviewProfile,
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
                latestResult={latestWorkspaceResult}
                diffRows={configDiffRows}
                updateConfig={updateConfig}
                resetConfig={resetConfig}
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
              previewProfile={isPreviewProfile}
              upgradeCdk={upgradeCdk}
              upgradeLoading={upgradeLoading}
              upgradeError={upgradeError}
              onUpgradeCdkChange={setUpgradeCdk}
              onUpgradePreviewProfile={handleUpgradePreviewProfile}
              onDownloadMAA={isPreviewProfile ? undefined : handleDownloadMAA}
              onApplySuggestions={handleApplySuggestions}
              onReset={onReset}
            />
          )}
        </div>
      </OptimizeShell>
    )
}
