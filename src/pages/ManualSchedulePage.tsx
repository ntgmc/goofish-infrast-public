import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import ManualScheduleEditor from '../components/result-panel/ManualScheduleEditor'
import { copy } from '../copy/index'
import { CONFIG_PRESETS, normalizeConfig } from '../lib/config'
import { createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson } from '../lib/manual-schedule-tool'
import { profileScopedPath, workspaceSetupPath } from '../lib/app-routes'
import { useSiteFeatures } from '../lib/site-feature-context'
import { mergeOperators } from '../lib/license'
import type { LicenseConfig, OptimizeResult } from '../lib/types'
import { useToolSession } from './tool/useToolSession'

export default function ManualSchedulePage() {
  const label = copy.tools.manualSchedule
  const session = useToolSession()
  const { features } = useSiteFeatures()
  const available = session.profiles.filter((profile) => isManualScheduleProfileAvailable(profile) &&
    (features.metered_billing || !profile.kind.startsWith('metered_')))
  const profile = available.find((entry) => entry.id === session.activeProfile?.id) ?? available[0]
  const ready = Boolean(profile && profile.id === session.activeProfile?.id && !session.openingProfileId)
  const operators = useMemo(() => ready
    ? mergeOperators(session.workspace?.operators ?? [], session.eliteOverrides) : [],
  [ready, session.workspace?.operators, session.eliteOverrides])
  const [preset, setPreset] = useState('')
  const [shiftHours, setShiftHours] = useState('8-8-8')
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
    if (profile && profile.id !== session.activeProfile?.id) {
      void session.refreshProfileWorkspace(profile).catch(() => undefined)
    }
  }, [profile, session.activeProfile?.id, session.refreshProfileWorkspace])

  useEffect(() => {
    setDraft(null)
    setError(null)
    setPreset('')
    setShiftHours('8-8-8')
    revision.current += 1
  }, [profile?.id])

  const configuration = (): LicenseConfig => ({
    ...normalizeConfig(preset ? CONFIG_PRESETS[preset] : session.workspace?.config ?? CONFIG_PRESETS['243']),
    schedule_mode: 'maa', dormitory_rule: 'fixed', shift_hours: shiftHours, Fiammetta: { enable: false },
    drones: { enable: false, order: 'pre', targets: [] },
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
      if (revision.current === run) setError(caught instanceof Error && caught.message === label.tooLarge ? label.tooLarge : label.importFailed)
    } finally {
      setImporting(false)
      if (upload.current) upload.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Link to="/tool/tools" aria-label={label.back}><BrandLogo /></Link>
        <div className="flex items-center gap-4">
          <Link to="/tool/tools" className="text-sm text-ink-secondary hover:text-ink-primary">{label.back}</Link>
          <ThemeSwitcher />
        </div>
      </header>
      <main className="space-y-6">
        <section className="tool-panel space-y-4 p-5 sm:p-6">
          <div>
            <h1 className="text-2xl font-semibold text-ink-primary">{label.title}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{label.description}</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{label.access}</p>
          </div>
          {session.authLoading ? <p role="status">{label.loading}</p> : session.authStatus === 'error' ? (
            <div className="tool-alert tool-alert--warning" role="alert">
              <p>{session.authError?.message}</p>
              <button type="button" className="tool-secondary-action mt-2" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button>
            </div>
          ) : !profile ? <p className="tool-alert tool-alert--warning p-3 text-sm" role="status">{label.unavailable}</p> : (
            <>
              <label className="block space-y-2 text-sm">
                <span>{label.profile}</span>
                <select className="tool-field" value={profile.id} disabled={Boolean(session.openingProfileId) || importing}
                  onChange={(event) => {
                    const selected = available.find((entry) => entry.id === event.target.value)
                    if (draft && !window.confirm(label.replace)) return
                    setDraft(null)
                    if (selected) void session.refreshProfileWorkspace(selected).catch(() => undefined)
                  }}>
                  {available.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}
                </select>
              </label>
              {ready && !operators.some((operator) => operator.own) && <p className="text-sm text-ink-secondary">
                {label.operatorsRequired}{' '}
                <Link className="text-brand-500 underline" to={profileScopedPath(workspaceSetupPath('operators'), profile.id)}>{label.setup}</Link>
              </p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm">
                  <span>{label.layout}</span>
                  <select className="tool-field" value={preset} disabled={!enabled} onChange={(event) => setPreset(event.target.value)}>
                    <option value="">{label.currentLayout}</option>
                    {Object.entries(CONFIG_PRESETS).map(([key, config]) => <option key={key} value={key}>{config.desc}</option>)}
                  </select>
                </label>
                <label className="block space-y-2 text-sm">
                  <span>{label.shiftHours}</span>
                  <input className="tool-field" value={shiftHours} disabled={!enabled} onChange={(event) => setShiftHours(event.target.value)} />
                  <span className="block text-xs text-ink-muted">{label.shiftHint}</span>
                </label>
              </div>
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
        </section>
        {canUse && draft?.profileId === profile?.id && draft && (
          <ManualScheduleEditor key={`${draft.profileId}:${draft.revision}`} source={draft.source}
            profileId={draft.profileId} draftStorageKey={`tool:${draft.profileId}`}
            operators={operators} simulationBaseline={{ config: draft.config }} />
        )}
      </main>
    </div>
  )
}
