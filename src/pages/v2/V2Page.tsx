import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { copy } from '../../copy'
import ScheduleProgress from '../../components/ScheduleProgress'
import { normalizeConfig } from '../../lib/config'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { LicenseConfig, LicenseOperator, OptimizeResult } from '../../lib/types'
import { isSchedulableProfile } from '../tool/tool-utils'
import { useToolSession } from '../tool/useToolSession'
import { useOptimizeWorkflow } from '../tool/optimize/useOptimizeWorkflow'
import V2Dashboard from './V2Dashboard'
import type { V2Session } from './OptionsDrawer'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import './v2.css'

export default function V2Page() {
  const [params] = useSearchParams()
  const session = useToolSession(params.get('profile_id'))
  const features = useSiteFeatures()
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(SAMPLE_CONFIG))
  const [operators, setOperators] = useState(SAMPLE_OPERATORS)
  const [changed, setChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeConfig = session.configOverride ?? session.workspace?.config ?? config
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
      await session.persistWorkspacePatch({ operators: next, config: normalizeConfig(activeConfig), elite_overrides: {} })
    } else {
      setOperators(next)
      setChanged(true)
    }
  }

  if (features.status === 'ready' && features.features.site && features.features.profiles && session.user && session.activeProfile && session.license && isSchedulableProfile(session.activeProfile)) {
    return <ConnectedDashboard key={session.activeProfile.id} session={session} />
  }

  return <V2Dashboard session={session} result={SAMPLE_RESULT} operators={session.workspace?.operators ?? operators} config={activeConfig}
    sample configChanged={changed} onUpdateConfig={updateConfig} onImportOperators={importOperators} error={error}
    onOperatorsChange={(next) => {
      if (session.user && session.activeProfile && session.workspace?.operators) {
        void importOperators(next).catch((caught) => setError(caught instanceof Error ? caught.message : copy.v2.saveOperatorsFailed))
      } else { setOperators(next); setChanged(true) }
    }} />
}

function ConnectedDashboard({ session }: { session: V2Session }) {
  const profile = session.activeProfile!
  const license = session.license!
  const features = useSiteFeatures()
  const [reading, setReading] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retained, setRetained] = useState<OptimizeResult | null>(null)
  const [operatorsChanged, setOperatorsChanged] = useState(false)
  const loadedId = useRef<string | null>(null)
  const ignoreSectionChange = useCallback(() => undefined, [])
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
    section: 'result',
    onSectionChange: ignoreSectionChange,
    onReset: ignoreSectionChange,
    onLogout: session.handleLogout,
    announcement: session.banner,
    redeemedNotice: null,
    onProfileUpgraded: session.applyAuthPayload,
  })
  const latest = workflow.latestWorkspaceResult
  const current = workflow.finalResult ?? workflow.currentResult ?? workflow.historyItem?.result ?? null
  const generationDisabledReason = features.features.schedule_generation ? null : copy.features.schedule_read_only

  useEffect(() => { if (current) setRetained(current) }, [current])
  useEffect(() => { if (workflow.currentResult || workflow.finalResult) setOperatorsChanged(false) }, [workflow.currentResult, workflow.finalResult])
  useEffect(() => {
    if (!latest || loadedId.current === latest.id || workflow.loading) return
    loadedId.current = latest.id
    setReading(true)
    void workflow.handleViewHistory(latest).finally(() => setReading(false))
  }, [latest, workflow.handleViewHistory, workflow.loading])

  async function saveOperators(operators: LicenseOperator[]) {
    if (saveBusy || workflow.loading) return
    setSaveBusy(true)
    setError(null)
    try {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      await session.persistWorkspacePatch({ operators, elite_overrides: {} })
      setOperatorsChanged(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.v2.saveOperatorsFailed)
    } finally {
      setSaveBusy(false)
    }
  }

  async function generate() {
    if (generationDisabledReason) { setError(generationDisabledReason); return }
    if (!await session.flushConfigSave()) { setError(copy.v2.saveFailed); return }
    setError(null)
    await workflow.handleGenerate()
  }

  const result = current ?? retained
  return <V2Dashboard session={session} result={result ?? SAMPLE_RESULT} operators={workflow.mergedOperators} config={workflow.activeConfig}
    sample={!result} configChanged={Boolean(result && (operatorsChanged || workflow.configDiffRows.length > 0 || session.configOverride))}
    onUpdateConfig={workflow.updateConfig} onOperatorsChange={(operators) => void saveOperators(operators)}
    onImportOperators={async (operators) => {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      await session.persistWorkspacePatch({ operators, elite_overrides: {} })
      setOperatorsChanged(true)
    }}
    onGenerate={() => void generate()} onExport={workflow.handleDownloadMAA}
    busy={workflow.loading || saveBusy || Boolean(workflow.workspaceBusyAction?.startsWith('download'))} loadingResult={reading} generationDisabledReason={generationDisabledReason}
    onRetryResult={latest ? () => { setReading(true); void workflow.handleViewHistory(latest).finally(() => setReading(false)) } : undefined}
    error={error ?? workflow.inlineError?.message ?? workflow.configToast?.message ?? workflow.workspaceError ?? (session.configSyncStatus === 'failed' ? copy.v2.saveFailed : null)}
    notice={workflow.workspaceNotice ?? (!features.features.schedule_generation ? copy.features.schedule_read_only : !result && !reading ? copy.v2.dataPending : null)}
    permission={workflow.permission} canEditConfig={workflow.userCanEditConfig || workflow.isPreviewProfile}
    canUseIntermediateConfig={workflow.userCanUseIntermediateAutoConfig} history={workflow.resultHistory} onHistory={workflow.handleViewHistory}>
    {workflow.loading && workflow.progress && <div className="v2-progress"><ScheduleProgress progress={workflow.progress} /></div>}
    {workflow.declarationDialog}
  </V2Dashboard>
}
