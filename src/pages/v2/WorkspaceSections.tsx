import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Coins, Sprout } from 'lucide-react'
import { Link } from 'react-router'
import AuthForm from '../../components/AuthForm'
import { copy } from '../../copy'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { useOptimizeWorkflow } from '../tool/optimize/useOptimizeWorkflow'
import type { AuthSuccessResponse } from '../../lib/types'
import type { V2Session } from './OptionsDrawer'
import { v2Path, v2SectionAvailable, type V2Section } from './navigation'
import { V2SectionLoading } from './V2LoadingScreen'

const Profiles = lazy(() => import('../tool/dashboard/ProfilesSection'))
const AddAccount = lazy(() => import('../tool/dashboard/RedeemSection'))
const Settings = lazy(() => import('../tool/dashboard/SettingsSection'))
const Announcements = lazy(() => import('../tool/dashboard/AnnouncementsSection'))
const PublicAnnouncements = lazy(() => import('../AnnouncementsPage'))
const Inventory = lazy(() => import('../tool/dashboard/InventorySection'))
const Balance = lazy(() => import('../tool/dashboard/BalanceSection'))
const Commercial = lazy(() => import('../tool/dashboard/CommercialProfilesSection'))
const ManualTool = lazy(() => import('../ManualSchedulePage'))
const Cultivation = lazy(() => import('../CultivationPlanPage'))
const Depot = lazy(() => import('../DepotValuePage'))
const Plans = lazy(() => import('../tool/optimize/PlansSection'))
const Overview = lazy(() => import('../tool/optimize/OverviewSection'))
const Lab = lazy(() => import('../tool/optimize/ScenarioLabSection'))
const LockedScenario = lazy(() => import('../tool/optimize/PaidCapabilityPreview').then((module) => ({ default: module.LockedScenarioPreview })))
const PreviewUpgrade = lazy(() => import('../tool/optimize/ResultSection').then((module) => ({ default: module.PreviewUpgradePanel })))
const PublicInfo = lazy(() => import('../PublicInfoPage'))
const Updates = lazy(() => import('../ChangelogPage'))
const Pricing = lazy(() => import('../PricingPage'))
const Status = lazy(() => import('../StatusPage'))

export type V2Workflow = ReturnType<typeof useOptimizeWorkflow>
export const sectionLabels: Record<V2Section, string> = {
  overview: copy.v2.overview, generation: copy.v2.generation, plans: copy.v2.history,
  lab: copy.v2.lab, tools: copy.v2.tools, 'manual-tool': copy.tools.manualSchedule.title,
  cultivation: copy.tools.cultivation.title, depot: copy.dashboard.pages_tool_dashboard_ToolsSection_001,
  profiles: copy.v2.account, 'add-account': copy.v2.addAccount, inventory: copy.inventory.nav,
  commercial: copy.metered.commercial_nav, balance: copy.balance.nav,
  announcements: copy.v2.announcements, settings: copy.v2.settings, help: copy.v2.helpAction, updates: copy.v2.updates,
  terms: copy.v2.terms, privacy: copy.v2.privacy, disclaimer: copy.public.pages_PublicInfoPage_055,
  support: copy.public.pages_PublicInfoPage_061, status: copy.status.pages_StatusPage_002, pricing: copy.v2.comparePlans,
}
const descriptions: Partial<Record<V2Section, string>> = {
  generation: copy.v2.generationDescription, plans: copy.v2.plansDescription,
  tools: copy.v2.toolsDescription, profiles: copy.v2.profilesDescription,
  'add-account': copy.v2.addAccountDescription, settings: copy.v2.settingsDescription,
  inventory: copy.v2.inventoryDescription,
}
const publicSections: V2Section[] = ['tools', 'depot', 'manual-tool', 'cultivation', 'announcements', 'help', 'updates', 'settings', 'terms', 'privacy', 'disclaimer', 'support', 'status', 'pricing']
const workflowSections: V2Section[] = ['generation', 'plans', 'lab']

export default function WorkspaceSections({ section, session, workflow, onAccountAdded, onToolDirtyChange, onOpenProfile, onNavigate, onConfig, generationDisabledReason }: {
  section: V2Section
  session: V2Session
  workflow?: V2Workflow
  onAccountAdded: (payload: AuthSuccessResponse) => Promise<void>
  onToolDirtyChange: (dirty: boolean) => void
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onNavigate: (section: V2Section) => void
  onConfig: () => void
  generationDisabledReason?: string | null
}) {
  const { features } = useSiteFeatures()
  const available = v2SectionAvailable(section, features)
  const [openedTools, setOpenedTools] = useState<V2Section[]>([])
  useEffect(() => {
    if (available && ['manual-tool', 'cultivation', 'depot'].includes(section)) setOpenedTools((current) => current.includes(section) ? current : [...current, section])
  }, [section, available])
  const signedIn = Boolean(session.user)
  const needsLogin = !signedIn && !publicSections.includes(section)
  const needsWorkspace = workflowSections.includes(section) && !workflow
  const ownsHeading = available && (['help', 'updates', 'terms', 'privacy', 'disclaimer', 'support', 'status', 'pricing'].includes(section) || (section === 'announcements' && !signedIn))
  return <section hidden={section === 'overview'} className="v2-feature-content v2-page-section" data-v2-section={section} aria-label={sectionLabels[section]}>
    {!ownsHeading && <div className="v2-section-heading"><div><h1>{sectionLabels[section]}</h1>{descriptions[section] && <p>{descriptions[section]}</p>}</div>
      {['manual-tool', 'cultivation', 'depot'].includes(section) && <Link className="v2-button v2-button-secondary" to={v2Path('tools', session.activeProfile?.id)}><ArrowLeft size={16} />{copy.v2.backToTools}</Link>}
      {section === 'profiles' && v2SectionAvailable('add-account', features) && <button type="button" className="v2-button v2-button-primary" onClick={() => onNavigate('add-account')}>{copy.v2.addAccount}<ArrowRight size={16} /></button>}
    </div>}
    <div className="v2-section-body">
    <Suspense fallback={<V2SectionLoading label={section === 'inventory' ? copy.inventory.loading : undefined} />}>
      {section === 'overview' ? null : !available ? <p className="v2-panel v2-section-loading" role="status">{copy.v2.featureUnavailable}</p>
        : needsLogin ? <div className="v2-panel v2-login-panel"><p>{copy.v2.signInRequired}</p><AuthForm compact allowCdk={false} onAuthenticated={session.applyAuthPayload} submitClassName="v2-button v2-button-primary w-full" /></div>
          : needsWorkspace ? <div className="v2-panel v2-section-loading"><p>{copy.v2.profileRequired}</p><button className="v2-button v2-button-primary" type="button" onClick={() => onNavigate('profiles')}>{copy.v2.account}</button></div>
            : <>
              {section === 'profiles' && <Profiles profiles={session.cdkProfiles} openingProfileId={session.openingProfileId} onOpen={(profile) => void onOpenProfile(profile)} onEdit={session.applyAuthPayload} meteredEnabled={features.metered_billing} />}
              {section === 'add-account' && <>
                <AddAccount preferPreview autoStartTour={false} onRedeemed={onAccountAdded} onInventoryRedeemed={() => onNavigate('inventory')} />
                {session.activeProfile?.kind === 'free_preview' && features.cdk_redemption && workflow && <details className="v2-panel mt-5 p-5"><summary className="cursor-pointer font-medium">{copy.workspace.pages_tool_WorkspaceSetupPage_052}</summary><PreviewUpgrade cdk={workflow.upgradeCdk} loading={workflow.upgradeLoading} error={workflow.upgradeError} onCdkChange={workflow.setUpgradeCdk} onSubmit={workflow.handleUpgradePreviewProfile} /></details>}
              </>}
              {section === 'settings' && (signedIn ? <Settings profiles={session.profiles} onLogout={session.handleLogout} onPayload={session.applyAuthPayload} /> : <GuestSettings />)}
              {section === 'announcements' && (signedIn ? <Announcements onUnreadCountChange={session.setAnnouncementUnreadCount} /> : <PublicAnnouncements embedded />)}
              {section === 'inventory' && <Inventory loadingFallback={<V2SectionLoading label={copy.inventory.loading} />} onPayload={session.applyAuthPayload} onLifetimeProfileCreated={() => onNavigate('profiles')} onViewProfiles={() => onNavigate('profiles')} />}
              {section === 'balance' && <Balance redemptionEnabled={features.cdk_redemption} />}
              {section === 'commercial' && <Commercial onOpen={(profile) => void onOpenProfile(profile)} />}
              {section === 'tools' && <Tools profileId={session.activeProfile?.id} />}

              {(['help', 'terms', 'privacy', 'disclaimer', 'support'] as V2Section[]).includes(section) && <PublicInfo page={section === 'help' ? 'faq' : section as 'terms' | 'privacy' | 'disclaimer' | 'support'} embedded />}
              {section === 'pricing' && <Pricing embedded />}
              {section === 'status' && <div className="v2-status-workspace"><Status embedded /></div>}
              {section === 'updates' && <Updates embedded />}
              {section === 'plans' && workflow && <Plans activeConfig={workflow.activeConfig} savedConfigs={workflow.savedConfigs} resultHistory={workflow.resultHistory} archivedResults={workflow.archivedResults}
                savedConfigLimit={workflow.profileCapacity?.plan_slots.limit} resultHistoryLimit={workflow.profileCapacity?.history_slots.limit} archiveLimit={workflow.profileCapacity?.archive_slots.limit}
                resultHistoryUsed={workflow.profileCapacity?.history_slots.used} archivedResultsUsed={workflow.profileCapacity?.archive_slots.used}
                resultHistoryHasMore={workflow.resultHistoryHasMore} archivedResultsHasMore={workflow.archivedResultsHasMore} historyLoadingScope={workflow.resultHistoryLoadingScope} historyLoadError={workflow.resultHistoryError}
                selectedHistoryId={workflow.historyItem?.id ?? null} configReadOnly={workflow.loading} busyAction={workflow.workspaceBusyAction} notice={workflow.workspaceNotice} error={workflow.workspaceError}
                onSaveCurrent={workflow.handleSaveCurrentConfig} onUseSavedConfig={workflow.handleUseSavedConfig} onRenameSavedConfig={workflow.handleRenameSavedConfig} onDeleteSavedConfig={workflow.handleDeleteSavedConfig}
                onViewHistory={workflow.handleViewHistory} onUseHistoryConfig={workflow.handleUseHistoryConfig} onDownloadHistory={workflow.handleDownloadHistory}
                onRenameArchivedHistory={workflow.handleRenameArchivedHistory} onArchiveHistory={workflow.handleArchiveHistory} onUnarchiveHistory={workflow.handleUnarchiveHistory} onDeleteHistory={workflow.handleDeleteHistory}
                onLoadMoreResultHistory={workflow.loadMoreResultHistory} onLoadMoreArchivedResults={workflow.loadMoreArchivedResults} />}
              {section === 'generation' && workflow && <Generation workflow={workflow} disabledReason={generationDisabledReason} onNavigate={onNavigate} onConfig={onConfig} />}
              {section === 'lab' && workflow && (workflow.userCanUseScenarioLab ? <Lab profileId={workflow.profile.id} operators={workflow.mergedOperators} activeConfig={workflow.activeConfig} configReadOnly={workflow.loading}
                requiresQuote={workflow.scenarioQuoteRequired} billingQuote={workflow.scenarioBillingQuote} billingQuoteLoading={workflow.scenarioBillingQuoteLoading} billingQuoteError={workflow.scenarioBillingQuoteError}
                onRefreshBillingQuote={workflow.refreshScenarioBillingQuote} onInventoryChange={workflow.refreshInventory} onApplyConfig={(config) => { workflow.handleApplyScenarioConfig(config); onConfig() }} />
                : <LockedScenario />)}
            </>}
    </Suspense>
    </div>
    {openedTools.map((tool) => <div key={tool} className="v2-section-body" hidden={section !== tool} inert={section !== tool}>
      <Suspense fallback={<V2SectionLoading />}>
        {tool === 'manual-tool' && v2SectionAvailable(tool, features) && <ManualTool embedded session={session} onDirtyChange={onToolDirtyChange} onOpenProfile={onOpenProfile} />}
        {tool === 'cultivation' && v2SectionAvailable(tool, features) && <Cultivation embedded session={session} />}
        {tool === 'depot' && v2SectionAvailable(tool, features) && <Depot embedded session={session} />}
      </Suspense>
    </div>)}
  </section>
}

const AnimationSettings = lazy(() => import('../../components/AnimationSettings'))
function GuestSettings() { return <div className="v2-panel v2-section-loading"><AnimationSettings /></div> }

function Tools({ profileId }: { profileId?: string }) {
  const { features } = useSiteFeatures()
  const tools = [
    { section: 'manual-tool' as const, enabled: features.manual_schedule, icon: CalendarDays, title: copy.tools.manualSchedule.title, description: copy.tools.manualSchedule.description },
    { section: 'cultivation' as const, enabled: features.cultivation_plan, icon: Sprout, title: copy.tools.cultivation.title, description: copy.tools.cultivation.description },
    { section: 'depot' as const, enabled: features.depot_value, icon: Coins, title: copy.dashboard.pages_tool_dashboard_ToolsSection_001, description: copy.dashboard.pages_tool_dashboard_ToolsSection_002 },
  ].filter((tool) => tool.enabled)
  return <div className="v2-tools-list">{tools.map(({ section, icon: Icon, title, description }) => <Link key={section} to={v2Path(section, profileId)} className="v2-tool-card"><span className="v2-tool-icon"><Icon size={24} aria-hidden="true" /></span><div className="v2-tool-description"><h2>{title}</h2><p>{description}</p></div><span className="v2-tool-arrow"><ArrowRight size={20} aria-hidden="true" /></span></Link>)}
    {!tools.length && <p className="v2-panel v2-section-loading">{copy.v2.featureUnavailable}</p>}
  </div>
}

function Generation({ workflow: w, disabledReason, onNavigate, onConfig }: { workflow: V2Workflow; disabledReason?: string | null; onNavigate: (section: V2Section) => void; onConfig: () => void }) {
  return <>
    {w.billingQuote && <p className="tool-inset p-4">{copy.metered.quote.summary(w.billingQuote.charge, w.billingQuote.available, w.billingQuote.tier, w.billingQuote.sufficient)}</p>}
    {w.billingQuoteError && <div className="tool-alert tool-alert--error" role="alert"><p>{w.billingQuoteError}</p><button type="button" className="tool-secondary-action mt-3" onClick={() => void w.refreshBillingQuote()}>{copy.metered.quote.retry}</button></div>}
    {w.billingQuote?.sufficient === false && <button className="tool-secondary-action" type="button" onClick={() => onNavigate('balance')}>{copy.metered.quote.go_to_balance}</button>}
    {(w.inventoryError || w.priorityCouponError) && <div className="tool-alert tool-alert--error" role="alert"><p>{w.inventoryError ?? w.priorityCouponError}</p><button type="button" className="tool-secondary-action mt-3" disabled={w.inventoryLoading || w.priorityCouponLoading} onClick={() => { void w.refreshInventory(); void w.refreshRewardBalance() }}>{copy.optimize.pages_tool_optimize_OptimizeWorkflowPage_006}</button></div>}
    <Overview activeConfig={w.activeConfig} configChanged={w.configChanged} showConfigDetails={w.userCanEditConfig} operatorCount={w.mergedOperators.length}
      configPresetLabel={w.configPresetLabel} validation={w.configValidation} loading={w.loading} syncing={w.licenseSyncing} progress={w.progress?.mode === 'generate' ? w.progress : null}
      hasResult={w.hasResult} resultIsCurrent={w.resultIsCurrent} error={w.inlineError?.scope === 'generate' ? w.inlineError.message : null}
      priorityCoupon={{ balance: w.priorityCouponBalance, selected: w.usePriorityCoupon, onChange: w.setUsePriorityCoupon }}
      additionalCoupons={!w.userCanUseUpgradeFeatures && (w.itemBalances.training_diagnosis_coupon ?? 0) > 0 ? [{ id: 'v2-training-coupon', label: copy.inventory.training_coupon, help: copy.inventory.training_coupon_help, balance: w.itemBalances.training_diagnosis_coupon ?? 0, selected: w.useTrainingDiagnosisCoupon, onChange: w.setUseTrainingDiagnosisCoupon }] : []}
      savedConfigCount={w.savedConfigs.length} savedConfigLimit={w.profileCapacity?.plan_slots.limit} resultHistoryCount={w.profileCapacity?.history_slots.used ?? w.resultHistory.length}
      resultHistoryLimit={w.profileCapacity?.history_slots.limit} latestResult={w.latestWorkspaceResult} generationDisabledReason={disabledReason}
      freeSchedule={{ visible: w.isRestrictedPreview }} onGenerate={w.handleGenerate}
      incrementalRecompute={{ visible: false, loading: w.loading, quote: w.incrementalBillingQuote, quoteLoading: w.incrementalBillingQuoteLoading, quoteError: w.incrementalBillingQuoteError, onRun: w.handleIncrementalRecompute }}
      onReset={w.onReset} onOpenPlans={() => onNavigate('plans')} onOpenConfig={onConfig}
      onViewHistory={w.handleViewHistory} onUseHistoryConfig={w.handleUseHistoryConfig} onDownloadHistory={w.handleDownloadHistory}
      downloadBusy={w.workspaceBusyAction === `download:${w.latestWorkspaceResult?.id ?? ''}`} />
  </>
}
