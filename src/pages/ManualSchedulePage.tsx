import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import FacilityLayoutEditor from '../components/FacilityLayoutEditor'
import OperatorSkillPreview from '../components/result-panel/OperatorSkillPreview'
import { OperatorAvatarTile } from '../components/result-panel/OperatorAvatarStrip'
import ManualScheduleEditor from '../components/result-panel/ManualScheduleEditor'
import { copy } from '../copy/index'
import { CONFIG_PRESETS, normalizeConfig } from '../lib/config'
import { createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson } from '../lib/manual-schedule-tool'
import { profileScopedPath, workspaceSetupPath } from '../lib/app-routes'
import { v2Path } from './v2/navigation'
import { useSiteFeatures } from '../lib/site-feature-context'
import { mergeOperators } from '../lib/license'
import type { LicenseConfig, OptimizeResult } from '../lib/types'
import { useToolSession } from './tool/useToolSession'

type PageProps = { embedded?: boolean; session?: ReturnType<typeof useToolSession>; onDirtyChange?: (dirty: boolean) => void; onOpenProfile?: (profile: ReturnType<typeof useToolSession>['profiles'][number]) => Promise<void> }

export default function ManualSchedulePage({ embedded = false, session, onDirtyChange, onOpenProfile }: PageProps = {}) {
  return session ? <ManualScheduleContent session={session} embedded={embedded} onDirtyChange={onDirtyChange} onOpenProfile={onOpenProfile} /> : <StandaloneManualSchedule />
}

function StandaloneManualSchedule() {
  const session = useToolSession()
  return <ManualScheduleContent session={session} />
}

export function useManualTool({ session, embedded = false, onDirtyChange }: PageProps & { session: ReturnType<typeof useToolSession> }) {
  const label = copy.tools.manualSchedule
  const { features } = useSiteFeatures()
  const available = session.profiles.filter((profile) => isManualScheduleProfileAvailable(profile) &&
    (features.metered_billing || !profile.kind.startsWith('metered_')))
  const profile = available.find((entry) => entry.id === session.activeProfile?.id) ?? available[0]
  const ready = Boolean(profile && profile.id === session.activeProfile?.id && !session.openingProfileId)
  const operators = useMemo(() => ready
    ? mergeOperators(session.workspace?.operators ?? [], session.eliteOverrides) : [],
  [ready, session.workspace?.operators, session.eliteOverrides])
  const [preset, setPreset] = useState('')
  const [shiftHours, setShiftHours] = useState<string | null>(null)
  const [configDraft, setConfigDraft] = useState<LicenseConfig | null>(null)
  const baseConfig = configDraft ?? normalizeConfig(preset ? CONFIG_PRESETS[preset] : session.workspace?.config ?? CONFIG_PRESETS['243'])
  const configuredHours = shiftHours ?? (Array.isArray(baseConfig.shift_hours) ? baseConfig.shift_hours.join('-') : baseConfig.shift_hours ?? '8-8-8')
  const [draft, setDraft] = useState<{ source: OptimizeResult; config: LicenseConfig; profileId: string; revision: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const revision = useRef(0)
  const profileId = useRef(profile?.id)
  profileId.current = profile?.id
  const canUse = session.authStatus === 'authenticated' && ready && operators.some((operator) => operator.own) && features.schedule_generation
  const enabled = canUse && !importing

  useEffect(() => {
    if (!embedded && profile && profile.id !== session.activeProfile?.id) {
      void session.refreshProfileWorkspace(profile).catch(() => undefined)
    }
  }, [embedded, profile, session.activeProfile?.id, session.refreshProfileWorkspace])

  useEffect(() => {
    onDirtyChange?.(false)
    setDraft(null)
    setError(null)
    setPreset('')
    setConfigDraft(null)
    setShiftHours(null)
    revision.current += 1
  }, [profile?.id])

  const configuration = (): LicenseConfig => ({
    ...baseConfig,
    schedule_mode: 'maa', dormitory_rule: 'fixed', shift_hours: configuredHours, Fiammetta: { enable: false },
    drones: { enable: false, order: 'pre', targets: [] },
    variable_shift_schedule: undefined,
  })

  function start() {
    if (!enabled || !profile) return
    if (draft && !window.confirm(label.replace)) return
    try {
      const config = configuration()
      const source = createBlankManualSchedule(config)
      setDraft({ source, config, profileId: profile.id, revision: ++revision.current })
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : label.importFailed)
    }
  }

  async function importSchedule(file: File | undefined) {
    if (!file || !enabled || !profile) return
    const selectedProfileId = profile.id
    const run = ++revision.current
    setImporting(true)
    setError(null)
    try {
      if (file.size > 5_000_000) throw new Error(label.tooLarge)
      const config = configuration()
      const source = parseManualScheduleJson(await file.text(), config, operators)
      if (revision.current === run && profileId.current === selectedProfileId) {
        if (draft && !window.confirm(label.replace)) return
        setDraft({ source, config, profileId: selectedProfileId, revision: run })
      }
    } catch (caught) {
      if (revision.current === run) setError(caught instanceof Error &&
        [label.tooLarge, label.importLayoutMismatch, label.fiammettaInvalid, copy.common.facilityLayoutRequired].some((message) => message === caught.message)
        ? caught.message : label.importFailed)
    } finally {
      setImporting(false)
      if (upload.current) upload.current.value = ''
    }
  }

  return { available, profile, ready, operators, preset, setPreset, setConfigDraft, baseConfig, configuredHours,
    setShiftHours, draft, error, importing, upload, canUse, enabled, start, importSchedule }
}

function ManualScheduleContent({ session, embedded = false, onDirtyChange, onOpenProfile }: PageProps & { session: ReturnType<typeof useToolSession> }) {
  const label = copy.tools.manualSchedule
  const ContentRoot = embedded ? 'div' : 'main'
  const operatorsPath = (profileId: string) => embedded ? `${v2Path('overview', profileId)}&panel=operators` : profileScopedPath(workspaceSetupPath('operators'), profileId)
  const { available, profile, ready, operators, preset, setPreset, setConfigDraft, baseConfig, configuredHours,
    setShiftHours, draft, error, importing, upload, canUse, enabled, start, importSchedule } = useManualTool({ session, embedded, onDirtyChange })
  return (
    <div className={embedded ? 'v2-embedded-tool' : 'mx-auto max-w-7xl px-4 py-6 sm:px-6'}>
      {!embedded && <header className="mb-8 flex items-center justify-between gap-4">
        <Link to="/tool/tools" aria-label={label.back}><BrandLogo /></Link>
        <div className="flex items-center gap-4">
          <Link to="/tool/tools" className="text-sm text-ink-secondary hover:text-ink-primary">{label.back}</Link>
          <ThemeSwitcher />
        </div>
      </header>}
      <ContentRoot className="space-y-6">
        <section className="workspace-manual-setup tool-panel space-y-4 p-5 sm:p-6">
          <div className="workspace-manual-intro">
            {!embedded && <h1 className="text-2xl font-semibold text-ink-primary">{label.title}</h1>}
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{label.description}</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{label.access}</p>
          </div>
          <div className="workspace-manual-inputs space-y-4">
          {session.authLoading ? <p role="status">{label.loading}</p> : session.authStatus === 'error' ? (
            <div className="tool-alert tool-alert--warning" role="alert">
              <p>{session.authError?.message}</p>
              <button type="button" className="tool-secondary-action mt-2" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button>
            </div>
          ) : !profile ? <p className="tool-alert tool-alert--warning p-3 text-sm" role="status">{label.unavailable}</p> : (
            <>
              <label className="block space-y-2 text-sm">
                <span>{label.profile}</span>
                <select className="tool-field" value={embedded && !ready ? "" : profile.id} disabled={Boolean(session.openingProfileId) || importing}
                  onChange={(event) => {
                    const selected = available.find((entry) => entry.id === event.target.value)
                    if (!selected) return
                    if (onOpenProfile) { void onOpenProfile(selected); return }
                    if (draft && !window.confirm(label.replace)) return
                    void session.flushConfigSave().then((saved) => saved ? session.refreshProfileWorkspace(selected) : undefined).catch(() => undefined)
                  }}>
                  {embedded && !ready && <option value="" disabled>{copy.common.pages_tool_useToolSession_004}</option>}
                  {available.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}
                </select>
              </label>
              {ready && !operators.some((operator) => operator.own) && <p className="text-sm text-ink-secondary">
                {label.operatorsRequired}{' '}
                <Link className="text-brand-500 underline" to={operatorsPath(profile.id)}>{label.setup}</Link>
              </p>}
              {ready && operators.some((operator) => operator.own) && <details className="tool-inset p-4">
                <summary className="cursor-pointer text-sm font-medium">{label.operators} · {operators.filter((operator) => operator.own).length}</summary>
                <p className="my-3 text-xs leading-5 text-ink-muted">{label.operatorsHint}</p>
                <OperatorSkillPreview>
                  <div className="grid max-h-64 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
                    {operators.filter((operator) => operator.own).map((operator) => <div key={operator.id} className="flex items-center gap-2">
                      <OperatorAvatarTile operator={operator} compact showFullNames />
                      <span className="text-xs text-ink-secondary">{copy.domain.building_skills.unlock(operator.elite, Number(operator.level) || 1)}</span>
                    </div>)}
                  </div>
                </OperatorSkillPreview>
                <Link className="mt-3 inline-block text-sm text-brand-500 underline" to={operatorsPath(profile.id)}>{label.editOperators}</Link>
              </details>}
              <p className="text-xs leading-5 text-ink-muted">{label.configHint}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm">
                  <span>{label.layout}</span>
                  <select className="tool-field" value={preset} disabled={!enabled} onChange={(event) => { setPreset(event.target.value); setConfigDraft(null) }}>
                    <option value="">{label.currentLayout}</option>
                    {Object.entries(CONFIG_PRESETS).map(([key, config]) => <option key={key} value={key}>{config.desc}</option>)}
                  </select>
                </label>
                <label className="block space-y-2 text-sm">
                  <span>{label.shiftHours}</span>
                  <input className="tool-field" value={configuredHours} disabled={!enabled} onChange={(event) => setShiftHours(event.target.value)} />
                  <span className="block text-xs text-ink-muted">{label.shiftHint}</span>
                </label>
              </div>
              {ready && baseConfig.layout === '2-5-2' && <FacilityLayoutEditor
                key={`${profile.id}:${preset}`} config={baseConfig} onUpdate={(mutate) => {
                  const next = structuredClone(baseConfig)
                  mutate(next)
                  setConfigDraft(next)
                }} />}
            </>
          )}
          {session.workspaceLoadError && <div role="alert" className="text-sm text-warning">
            <p>{session.workspaceLoadError}</p>
            {profile && <button type="button" className="tool-secondary-action mt-2" disabled={Boolean(session.openingProfileId)}
              onClick={() => void session.refreshProfileWorkspace(profile).catch(() => undefined)}>{label.retryWorkspace}</button>}
          </div>}
          {error && <p role="alert" className="text-sm text-warning">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="tool-primary-action" disabled={!enabled} onClick={start}>{label.start}</button>
            <button type="button" className="tool-secondary-action" disabled={!enabled} onClick={() => upload.current?.click()}>{label.import}</button>
            <input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label={label.import}
              disabled={!enabled} onChange={(event) => void importSchedule(event.target.files?.[0])} />
          </div>
          {profile && <p className="text-xs leading-5 text-ink-muted">{label.importHint}</p>}
          {draft && <p className="text-sm text-warning">{label.replace}</p>}
          </div>
        </section>
        {canUse && draft?.profileId === profile?.id && draft && (
          <ManualScheduleEditor key={`${draft.profileId}:${draft.revision}`} source={draft.source}
            profileId={draft.profileId} draftStorageKey={`tool:${draft.profileId}`}
            operators={operators} simulationBaseline={{ config: draft.config }} onDirtyChange={onDirtyChange} />
        )}
      </ContentRoot>
    </div>
  )
}
