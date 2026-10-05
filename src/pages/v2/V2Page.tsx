import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ResultErrorBoundary } from '../tool/optimize/ResultSection'
import OptimizationTaskCenterDialog, { OptimizationTaskCenterButton } from '../tool/optimize/OptimizationTaskCenter'
import { restoreScenarioComparisonJob } from '../tool/optimize/scenario-lab/useScenarioComparison'
import type { WorkspaceResultHistorySummary } from '../../lib/types'
import { DialogSurfaceProvider } from '../../components/ui/dialog'
import { NotificationCenterProvider } from '../../components/NotificationCenter'
import { InternalLinkProvider } from '../../components/InternalLink'
import { useNavigate, useSearchParams } from 'react-router'
import { copy } from '../../copy'
import ScheduleProgress from '../../components/ScheduleProgress'
import { normalizeConfig } from '../../lib/config'
import { hasCapability } from '../../lib/product-catalog'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { LicenseConfig, LicenseOperator, OptimizeResult } from '../../lib/types'
import { getEffectiveProfilePermission, isFreePreviewProfile, isSchedulableProfile } from '../tool/tool-utils'
import { useToolSession } from '../tool/useToolSession'
import { useOptimizeWorkflow } from '../tool/optimize/useOptimizeWorkflow'
import { useOptimizationTaskCenter } from '../tool/optimize/useOptimizationTaskCenter'
import V2Dashboard from './V2Dashboard'
import V2LoadingScreen from './V2LoadingScreen'
import type { V2Session } from './OptionsDrawer'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import { v2Href, v2Path, v2Section } from './navigation'
import { METERED_BILLING_AVAILABLE } from '../../lib/site-features'
import './v2.css'
import './workspace-pages.css'

export default function V2Page() {
  const [params] = useSearchParams()
  const session = useToolSession(params.get('profile_id'))
  const features = useSiteFeatures()
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(SAMPLE_CONFIG))
  const [operators, setOperators] = useState(SAMPLE_OPERATORS)
  const [changed, setChanged] = useState(false)
  const activeConfig = session.configOverride ?? session.workspace?.config ?? config
  const profile = session.activeProfile
  const permission = profile ? getEffectiveProfilePermission(profile) : undefined
  const updateConfig = (mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(activeConfig)
    mutate(next)
    if (session.user && session.activeProfile) session.setConfigOverride(normalizeConfig(next))
    else setConfig(normalizeConfig(next))
    setChanged(true)
  }
  async function importOperators(next: LicenseOperator[]) {
    if (session.user && session.activeProfile) {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      await session.persistWorkspacePatch({ operators: next, elite_overrides: {} })
    } else {
      setOperators(next)
      setChanged(true)
    }
  }

  if (features.status === 'loading') return <V2LoadingScreen />
  if (features.status === 'error') return <V2LoadingScreen error={copy.features.load_failed_body} onRetry={features.retry} retryLabel={copy.features.retry} />
  if (session.authStatus === 'loading') return <V2LoadingScreen />
  if (session.authStatus === 'error') return <V2LoadingScreen error={copy.common.pages_ToolPage_003} onRetry={session.retryAuth} retryLabel={copy.common.pages_ToolPage_005} />

  if (features.features.site && features.features.profiles && session.user && session.activeProfile && session.license && isSchedulableProfile(session.activeProfile)) {
    return <SessionProviders session={session}><ConnectedDashboard key={session.activeProfile.id} session={session} /></SessionProviders>
  }

  return <SessionProviders session={session}><V2Dashboard session={session} result={SAMPLE_RESULT} operators={session.workspace?.operators ?? operators} config={activeConfig}
    sample configChanged={changed} onUpdateConfig={updateConfig} onImportOperators={importOperators}
    permission={permission} canEditConfig={!profile || hasCapability({ permission }, 'edit_full_config')}
    canUseIntermediateConfig={!profile || isFreePreviewProfile(profile) || hasCapability({ permission }, 'use_intermediate_auto_config')}
    canViewAnalysis={!profile || hasCapability({ kind: profile.kind, permission }, 'view_full_data')} /></SessionProviders>
}

function SessionProviders({ session, children }: { session: V2Session; children: ReactNode }) {
  const resolveHref = useCallback((href: string) => v2Href(href, session.activeProfile?.id), [session.activeProfile?.id])
  return <InternalLinkProvider value={resolveHref}><DialogSurfaceProvider value="v2-dialog v2-feature-content">{session.user ? <NotificationCenterProvider userId={session.user.id}>{children}</NotificationCenterProvider> : children}</DialogSurfaceProvider></InternalLinkProvider>
}

function ConnectedDashboard({ session }: { session: V2Session }) {
  const profile = session.activeProfile!
  const license = session.license!
  const features = useSiteFeatures()
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const taskCenterButton = useRef<HTMLButtonElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retained, setRetained] = useState<OptimizeResult | null>(null)
  const [operatorsChanged, setOperatorsChanged] = useState(false)
  const loadedId = useRef<string | null>(null)
  const readingLatest = useRef(false)
  const manualDirty = useRef(false)
  const onManualDirtyChange = useCallback((dirty: boolean) => { manualDirty.current = dirty }, [])
  const confirmResultChange = () => !manualDirty.current || window.confirm(copy.v2.discardManual)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const onSectionChange = useCallback((section: 'overview' | 'plans' | 'config' | 'result' | 'lab') => {
    if (section === 'result') {
      if (!readingLatest.current) void navigate(v2Path('overview', profile.id))
      return
    }
    void navigate(section === 'config' ? `${v2Path('overview', profile.id)}&panel=config` : v2Path(section === 'overview' ? 'generation' : section, profile.id))
  }, [navigate, profile.id])
  const onReset = useCallback(() => { void navigate(`${v2Path('overview', profile.id)}&panel=operators`) }, [navigate, profile.id])
  const workflow = useOptimizeWorkflow({
    profileId: profile.id,
    profile,
    license,
    workspace: session.workspace,
    setLicense: session.setLicense,
    eliteOverrides: session.eliteOverrides,
    configOverride: session.configOverride,
    setConfigOverride: session.setConfigOverride,
    configSyncStatus: session.configSyncStatus,
    flushConfigSave: session.flushConfigSave,
    retryConfigSave: session.retryConfigSave,
    onWorkspacePatch: session.persistWorkspacePatch,
    onWorkspaceUpdated: session.applyWorkspaceSnapshot,
    section: v2Section(params) === 'lab' ? 'lab' : v2Section(params) === 'plans' ? 'plans' : v2Section(params) === 'generation' ? 'overview' : 'result',
    onSectionChange,
    onReset,
    onLogout: session.handleLogout,
    announcement: session.banner,
    redeemedNotice: null,
    onProfileUpgraded: session.applyAuthPayload,
  })
  const tasks = useOptimizationTaskCenter(profile.id, taskCenterOpen || workflow.loading)
  const activeJob = tasks.jobs.find((job) => job.id === workflow.progress?.jobId && job.canCancel)
  const latest = workflow.latestWorkspaceResult
  const current = workflow.finalResult ?? workflow.currentResult ?? workflow.historyItem?.result ?? null
  const metered = METERED_BILLING_AVAILABLE && profile.kind.startsWith('metered_')
  const generationDisabledReason = !features.features.schedule_generation ? copy.features.schedule_read_only
    : metered && workflow.billingQuoteLoading ? copy.metered.quote.loading
      : metered && (workflow.billingQuoteError || !workflow.billingQuote) ? copy.metered.quote.load_failed
        : metered && !workflow.billingQuote?.sufficient ? copy.metered.quote.insufficient : null
  const readLatestResult = useCallback(async () => {
    if (!latest) return
    loadedId.current = latest.id
    readingLatest.current = true
    setReading(true)
    setError(null)
    try {
      await workflow.handleViewHistory(latest)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.v2.resultLoadFailed)
    } finally {
      readingLatest.current = false
      setReading(false)
    }
  }, [latest, workflow.handleViewHistory])

  useEffect(() => { if (current) setRetained(current) }, [current])
  useEffect(() => { if (workflow.currentResult || workflow.finalResult) setOperatorsChanged(false) }, [workflow.currentResult, workflow.finalResult])
  useEffect(() => {
    if (!latest || loadedId.current === latest.id || workflow.loading) return
    if (workflow.currentResult || workflow.finalResult) { loadedId.current = latest.id; return }
    void readLatestResult()
  }, [latest, readLatestResult, workflow.loading, workflow.currentResult, workflow.finalResult])

  async function generate() {
    if (!confirmResultChange()) return
    if (generationDisabledReason) { setError(generationDisabledReason); return }
    if (!await session.flushConfigSave()) { setError(workflow.configValidation.ok ? copy.v2.saveFailed : workflow.configValidation.message); return }
    setError(null)
    await workflow.handleGenerate()
  }

  function closeTaskCenter() {
    setTaskCenterOpen(false)
    taskCenterButton.current?.focus()
  }
  const taskCenterAction = <OptimizationTaskCenterButton controller={tasks} open={taskCenterOpen} onOpen={() => setTaskCenterOpen(true)} buttonRef={taskCenterButton} iconOnly />
  const taskCenterDialog = <OptimizationTaskCenterDialog open={taskCenterOpen} controller={tasks} onClose={closeTaskCenter} retryEnabled={features.features.schedule_generation}
    onRetrySchedule={() => { closeTaskCenter(); void generate() }} onOpenScenario={() => { closeTaskCenter(); void navigate(v2Path('lab', profile.id)) }}
    onOpenResult={(job) => { void (async () => {
      if (!confirmResultChange()) return
      if (job.kind === 'scenario_comparison') {
        restoreScenarioComparisonJob(profile.id, job.id)
        closeTaskCenter()
        void navigate(v2Path('lab', profile.id))
        return
      }
      const id = job.historyResultId ?? job.id
      const summary: WorkspaceResultHistorySummary = [...workflow.resultHistory, ...workflow.archivedResults].find((item) => item.id === id) ?? {
        id, job_id: job.id, name: copy.optimize.pages_tool_optimize_OptimizeWorkflowPage_002(new Date(job.timestamps.submittedAt).toLocaleString()),
        created_at: job.timestamps.finishedAt ?? job.timestamps.submittedAt, operator_count: workflow.mergedOperators.filter((operator) => operator.own).length,
        source: 'generated', archived: false, schedule_mode: null, maa_exportable: true, has_config: false,
      }
      await workflow.handleViewHistory(summary)
      closeTaskCenter()
      void navigate(v2Path('overview', profile.id))
    })().catch((caught) => setError(caught instanceof Error ? caught.message : copy.v2.resultLoadFailed)) }} />
  const result = current ?? retained
  const progress = workflow.progress && (workflow.progress.estimatePhase !== 'completed' || !current) && <div className="v2-progress"><ScheduleProgress progress={workflow.progress} />
    {workflow.loading && activeJob && <button type="button" className="v2-button v2-button-secondary" disabled={tasks.busyJobId === activeJob.id || activeJob.cancellationRequested}
      onClick={() => void tasks.cancel(activeJob)}>{tasks.busyJobId === activeJob.id || activeJob.cancellationRequested ? copy.v2.stopping : copy.v2.stopSchedule}</button>}
    {tasks.error && <p role="alert" className="v2-error">{tasks.error}</p>}
    {tasks.notice && <p role="status" className="v2-muted">{tasks.notice}</p>}
  </div>
  if (!result && latest && v2Section(params) === 'overview') {
    const pending = reading || loadedId.current !== latest.id
    return <V2LoadingScreen error={pending ? null : error ?? workflow.workspaceError ?? copy.v2.resultLoadFailed} onRetry={() => void readLatestResult()}>
      {progress}
    </V2LoadingScreen>
  }
  return <ResultErrorBoundary resetKey={[profile.id, workflow.historyItem?.id ?? workflow.progress?.jobId ?? 'none', v2Section(params)].join(':')} onDownloadDiagnostic={features.features.full_result_export && workflow.userCanDownloadFullResult ? workflow.handleDownloadFullResult : undefined} diagnosticDownloadBusy={Boolean(workflow.workspaceBusyAction?.startsWith('download'))}><V2Dashboard session={session} workflow={{ ...workflow, handleGenerate: generate, handleViewHistory: async (item) => {
      if (!confirmResultChange()) return
      await workflow.handleViewHistory(item)
    }, handleIncrementalRecompute: async () => {
      if (!confirmResultChange()) return
      if (generationDisabledReason) { setError(generationDisabledReason); return }
      if (!await session.flushConfigSave()) { setError(workflow.configValidation.ok ? copy.v2.saveFailed : workflow.configValidation.message); return }
      await workflow.handleIncrementalRecompute()
    } }} taskCenterAction={taskCenterAction} result={result ?? SAMPLE_RESULT} operators={workflow.mergedOperators} config={workflow.activeConfig}
    sample={!result} configChanged={Boolean(result && (operatorsChanged || workflow.configDiffRows.length > 0 || session.configOverride))}
    onUpdateConfig={workflow.updateConfig}
    onImportOperators={async (operators) => {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      await session.persistWorkspacePatch({ operators, elite_overrides: {} })
      setOperatorsChanged(true)
    }}
    onManualDirtyChange={onManualDirtyChange} onGenerate={() => void generate()} onExport={features.features.maa_export ? workflow.handleDownloadMAA : undefined}
    busy={workflow.loading || Boolean(workflow.workspaceBusyAction?.startsWith('download'))} loadingResult={reading} generationDisabledReason={generationDisabledReason}
    onRetryResult={latest ? () => void readLatestResult() : undefined}
    error={error ?? workflow.inlineError?.message ?? (workflow.configValidation.ok ? workflow.configToast?.message : null) ?? workflow.workspaceError ?? (session.configSyncStatus === 'failed' ? copy.v2.saveFailed : null)}
    notice={workflow.workspaceNotice ?? (!features.features.schedule_generation ? copy.features.schedule_read_only : !result && !reading ? copy.v2.dataPending : null)}
    permission={workflow.permission} canEditConfig={workflow.userCanEditConfig} canViewAnalysis={workflow.userCanViewFullData && !result?.preview_limit}
    canUseIntermediateConfig={workflow.userCanUseIntermediateAutoConfig}>
    {progress}
    {taskCenterDialog}
    {workflow.declarationDialog}
  </V2Dashboard></ResultErrorBoundary>
}
