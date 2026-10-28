import { useEffect, useMemo, useRef, useState } from 'react'
import { ComparisonIcon, UploadIcon } from '../../../components/icons'
import FacilityLayoutEditor from '../../../components/FacilityLayoutEditor'
import { OperatorAvatarTile } from '../../../components/result-panel/OperatorAvatarStrip'
import { ROOM_LABELS } from '../../../components/result-panel/labels'
import { copy, CURRENT_LOCALE } from '../../../copy'
import { canonicalJson } from '../../../lib/crypto'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import { mergeOperators } from '../../../lib/license'
import { isManualScheduleProfileAvailable, parseManualScheduleJson, UnownedScheduleOperatorsError } from '../../../lib/manual-schedule-tool'
import { createManualPlans } from '../../../lib/manual-schedule'
import { compareScheduleOperators, scheduleProductionMetrics, type ScheduleAssignment } from '../../../lib/schedule-comparison'
import { getOptimizePollRetryDelayMs } from '../../../lib/optimize-poll'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import type { LicenseConfig, LicenseOperator, OptimizeResult, UserWorkspace } from '../../../lib/types'
import { useQueryClient } from '@tanstack/react-query'
import { fetchCachedResultHistoryDetail } from '../../tool/optimize/result-history-query'
import { submitOptimizationJob } from '../../tool/optimize/optimization-api'
import { fetchOptimizeJobSnapshotStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, waitForOptimizePoll } from '../../tool/optimize/job-progress'
import { useResultHistoryPagination } from '../../tool/optimize/useResultHistoryPagination'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import { Facts, Field, Notice, SectionTitle } from '../components/WorkspaceUI'
import './schedule-comparison.css'

const text = copy.tools.scheduleComparison
const manual = copy.tools.manualSchedule
const sides = [text.before, text.after]
type Choice = { name: string; source: OptimizeResult; config: LicenseConfig }
type Slot = { selection: string; choice?: Choice; loading?: boolean; error?: string }

export default function ScheduleComparison({ session, onOpenProfile }: {
  session: V2Session
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
}) {
  const { features } = useSiteFeatures()
  const available = session.profiles.filter((profile) => isManualScheduleProfileAvailable(profile) &&
    (features.metered_billing || !profile.kind.startsWith('metered_')))
  const profile = available.find((entry) => entry.id === session.activeProfile?.id) ?? available[0]
  const ready = Boolean(profile && profile.id === session.activeProfile?.id && !session.openingProfileId)
  const operators = useMemo(() => mergeOperators(session.workspace?.operators ?? [], session.eliteOverrides), [session.workspace?.operators, session.eliteOverrides])
  const config = useMemo(() => normalizeConfig(session.workspace?.config ?? CONFIG_PRESETS['243']), [session.workspace?.config])
  return <div className="v2-schedule-comparison">
    <p className="v2-lead">{text.description}</p>
    {session.authLoading ? <Notice>{manual.loading}</Notice> : session.authStatus === 'error' ? <Notice error>{session.authError?.message}<button className="v2-text-button" onClick={session.retryAuth}>{copy.v2.retry}</button></Notice>
      : !profile ? <Notice>{text.unavailable}</Notice> : <>
        <label className="v2-field v2-schedule-comparison-profile"><span>{manual.profile}</span>
          <select className="v2-input" value={ready ? profile.id : ''} disabled={Boolean(session.openingProfileId)} onChange={(event) => {
            const next = available.find((entry) => entry.id === event.target.value)
            if (next) void onOpenProfile(next)
          }}><option value="" disabled>{copy.common.pages_tool_useToolSession_004}</option>{available.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select>
        </label>
        <Notice error>{session.workspaceLoadError}{session.workspaceLoadError && <button className="v2-text-button" disabled={Boolean(session.openingProfileId)} onClick={() => void session.refreshProfileWorkspace(profile).catch(() => undefined)}>{manual.retryWorkspace}</button>}</Notice>
        {ready && !operators.some((operator) => operator.own) ? <Notice>{text.operatorsRequired} <Link className="v2-text-button" to={`${v2Path('overview', profile.id)}&panel=operators`}>{manual.setup}</Link></Notice>
          : ready && <ComparisonWorkspace key={profile.id} userId={profile.user_id} profileId={profile.id} operators={operators} config={config} workspace={session.workspace} />}
      </>}
  </div>
}

function ComparisonWorkspace({ userId, profileId, operators, config, workspace }: {
  userId: string; profileId: string; operators: LicenseOperator[]; config: LicenseConfig; workspace: UserWorkspace | null
}) {
  const client = useQueryClient()
  const history = useResultHistoryPagination(profileId, workspace, userId)
  const [slots, setSlots] = useState<Slot[]>([{ selection: '' }, { selection: '' }])
  const [outputs, setOutputs] = useState<(OptimizeResult | null)[]>([null, null])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState('')
  const [shiftHours, setShiftHours] = useState<string | null>(null)
  const [configDraft, setConfigDraft] = useState<LicenseConfig | null>(null)
  const requests = useRef<(AbortController | null)[]>([null, null])
  const simulationRun = useRef(0)
  const simulationLock = useRef(false)
  const inputsKey = canonicalJson({ config, operators })
  const currentInputs = useRef(inputsKey)
  currentInputs.current = inputsKey
  const baseConfig = configDraft ?? (preset ? normalizeConfig(CONFIG_PRESETS[preset]) : config)
  const importConfig: LicenseConfig = { ...baseConfig, shift_hours: shiftHours ?? baseConfig.shift_hours }
  const configuredHours = Array.isArray(importConfig.shift_hours) ? importConfig.shift_hours.join('-') : importConfig.shift_hours ?? '8-8-8'
  const left = slots[0].choice
  const right = slots[1].choice
  const differences = useMemo(() => left && right ? compareScheduleOperators(left.source, right.source) : null, [left, right])

  useEffect(() => {
    setSlots([{ selection: '' }, { selection: '' }])
    setOutputs([null, null])
    setBusy(false)
    setProgress(null)
    setError(null)
    simulationLock.current = false
    return () => {
      requests.current.forEach((request) => request?.abort())
      simulationRun.current += 1
    }
  }, [inputsKey])

  async function select(index: number, selection: string, file?: File) {
    requests.current[index]?.abort()
    const controller = new AbortController()
    requests.current[index] = controller
    const current = () => !controller.signal.aborted && currentInputs.current === inputsKey
    setSlots((current) => current.map((slot, side) => side === index ? { selection, loading: true } : slot))
    setOutputs([null, null])
    setError(null)
    try {
      let source: OptimizeResult
      let fallback = importConfig
      let name = file?.name ?? ''
      if (file) {
        if (file.size > 5_000_000) throw new Error(manual.tooLarge)
        const content = await file.text()
        if (!current()) return
        source = parseManualScheduleJson(content, fallback, operators)
      } else {
        const item = await fetchCachedResultHistoryDetail(client, userId, profileId, selection)
        if (!current()) return
        fallback = normalizeConfig(item.config ?? importConfig)
        source = parseManualScheduleJson(JSON.stringify(item.result), fallback, operators)
        name = item.name
      }
      if (current()) setSlots((current) => current.map((slot, side) => side === index ? { selection, choice: { name, source, config: fallback } } : slot))
    } catch (cause) {
      if (!current()) return
      const message = cause instanceof Error && (cause instanceof UnownedScheduleOperatorsError ||
        [manual.tooLarge, manual.importMissingProduct, manual.fiammettaInvalid,
          copy.common.facilityLayoutRequired, copy.domain.lib_config_035].some((message) => message === cause.message)) ? cause.message : manual.importFailed
      setSlots((current) => current.map((slot, side) => side === index ? { selection, error: message } : slot))
    }
  }

  async function simulate() {
    if (!left || !right || simulationLock.current) return
    simulationLock.current = true
    const run = ++simulationRun.current
    const isCancelled = () => simulationRun.current !== run || currentInputs.current !== inputsKey
    setBusy(true)
    setError(null)
    setOutputs([null, null])
    let index = 0
    try {
      for (const choice of [left, right]) {
        setProgress(text.progress(sides[index], text.simulating))
        const accepted = await submitOptimizationJob({
          kind: 'schedule', identity: { type: 'profile', profileId }, operators, config: choice.config,
          includeUpgradeSuggestions: false, manualSchedule: { source: choice.source, plans: createManualPlans(choice.source), purpose: 'comparison' },
        }, text.failed)
        let failures = 0
        while (!isCancelled()) {
          try {
            const job = await fetchOptimizeJobSnapshotStatus<OptimizeResult>(accepted.job_id, text.failed, accepted.poll_token, isCancelled)
            if (isCancelled()) return
            failures = 0
            if (job.status === 'succeeded') {
              const side = index
              setOutputs((current) => current.map((output, i) => i === side ? job.result : output))
              break
            }
            if (job.status !== 'queued' && job.status !== 'running') throw new Error(job.error.message)
            setProgress(text.progress(sides[index], job.status === 'queued' ? text.queued : text.simulating))
            await waitForOptimizePoll(job.pollAfterMs ?? 1000, isCancelled)
          } catch (cause) {
            if (isOptimizeJobPollCancelled(cause)) return
            if (!isRetryableOptimizePollError(cause)) throw cause
            await waitForOptimizePoll(getOptimizePollRetryDelayMs(++failures), isCancelled)
          }
        }
        if (isCancelled()) return
        index += 1
      }
    } catch (cause) {
      if (!isCancelled() && !isOptimizeJobPollCancelled(cause)) setError(text.progress(sides[index], cause instanceof Error ? cause.message : text.failed))
    } finally {
      if (!isCancelled()) {
        simulationLock.current = false
        setBusy(false)
        setProgress(null)
      }
    }
  }

  return <>
    <p className="v2-muted">{text.basis}</p>
    <div className="v2-schedule-comparison-inputs">{slots.map((slot, index) => <section key={index} aria-label={sides[index]}>
      <SectionTitle title={sides[index]} />
      <label className="v2-field"><span>{text.select}</span><select className="v2-input" aria-label={`${sides[index]} · ${text.select}`} value={slot.selection} disabled={busy} onChange={(event) => void select(index, event.target.value)}>
        <option value="" disabled>{text.placeholder}</option>
        {slot.selection === 'json' && <option value="json" disabled>{slot.choice?.name ?? text.import}</option>}
        <optgroup label={text.active}>{history.resultHistory.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        <optgroup label={text.archived}>{history.archivedResults.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
      </select></label>
      <label className="v2-button v2-button-secondary v2-schedule-comparison-upload" aria-disabled={busy}>
        <UploadIcon size={16} aria-hidden="true" />{text.import}<input type="file" accept=".json,application/json" aria-label={`${sides[index]} · ${text.import}`} disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void select(index, 'json', file)
          event.target.value = ''
        }} />
      </label>
      {slot.loading && <p role="status">{text.loading}</p>}
      <Notice error>{slot.error}</Notice>
      {slot.choice && <div className="v2-schedule-comparison-choice"><strong>{slot.choice.name}</strong><p>{text.summary(slot.choice.source.plans.length, slot.choice.source.total_schedule_hours ?? 24)}</p></div>}
    </section>)}</div>
    {(history.resultHistoryHasMore || history.archivedResultsHasMore) && <div className="v2-actions">
      {history.resultHistoryHasMore && <button className="v2-text-button" disabled={history.loadingScope !== null} onClick={() => void history.loadMoreResultHistory()}>{copy.optimize.pages_tool_optimize_result_history_load_more}</button>}
      {history.archivedResultsHasMore && <button className="v2-text-button" disabled={history.loadingScope !== null} onClick={() => void history.loadMoreArchivedResults()}>{copy.inventory.archive_title} · {copy.optimize.pages_tool_optimize_result_history_load_more}</button>}
    </div>}
    <Notice error>{history.error}</Notice>
    <details className="v2-disclosure v2-schedule-comparison-settings"><summary>{text.importSettings}</summary><p>{text.importHint}</p>
      <div className="v2-schedule-comparison-inputs"><label className="v2-field"><span>{manual.layout}</span><select className="v2-input" value={preset} disabled={busy} onChange={(event) => { setPreset(event.target.value); setConfigDraft(null) }}>
        <option value="">{manual.currentLayout}</option>{Object.entries(CONFIG_PRESETS).map(([key, value]) => <option key={key} value={key}>{value.desc}</option>)}
      </select></label><Field label={manual.shiftHours} help={manual.shiftHint} value={configuredHours} disabled={busy} onChange={(event) => setShiftHours(event.target.value)} /></div>
      {baseConfig.layout === '2-5-2' && <FacilityLayoutEditor config={baseConfig} onUpdate={(mutate) => { const next = structuredClone(baseConfig); mutate(next); setConfigDraft(next) }} />}
    </details>
    <div className="v2-actions v2-schedule-comparison-run"><button className="v2-button v2-button-primary" disabled={busy || !left || !right} onClick={() => void simulate()}><ComparisonIcon size={18} aria-hidden="true" />{busy ? text.running : text.start}</button><p role="status" aria-live="polite">{progress}</p></div>
    <Notice error>{error}</Notice>
    {outputs.some(Boolean) && <ProductionComparison outputs={outputs} names={[left?.name ?? '', right?.name ?? '']} />}
    {differences && <OperatorComparison differences={differences} operators={operators} />}
  </>
}

function ProductionComparison({ outputs, names }: { outputs: (OptimizeResult | null)[]; names: string[] }) {
  const values = outputs.map(scheduleProductionMetrics)
  return <section className="v2-schedule-comparison-results" aria-label={text.production}>
    <SectionTitle title={text.production} description={text.productionHint} />
    {outputs.some((output) => output && !output.daily_production) && <Notice error>{text.missingProduction}</Notice>}
    <div className="v2-comparison-table" role="region" aria-label={`${text.production} · ${text.metric}`} tabIndex={0}><table>
      <thead><tr><th scope="col">{text.metric}</th><th scope="col">{text.before}<small>{names[0]}</small></th><th scope="col">{text.after}<small>{names[1]}</small></th><th scope="col">{text.delta}</th><th scope="col">{text.percent}</th></tr></thead>
      <tbody>{Object.entries(text.metrics).map(([key, label]) => {
        const metric = key as keyof NonNullable<ReturnType<typeof scheduleProductionMetrics>>
        const before = values[0]?.[metric]
        const after = values[1]?.[metric]
        const delta = before != null && after != null ? after - before : null
        return <tr key={key}><th scope="row">{label}</th><td>{format(before)}</td><td>{format(after)}</td><td>{format(delta, true)}</td><td>{before != null && before > 0 && delta != null ? `${format(delta / before * 100, true)}%` : '—'}</td></tr>
      })}</tbody>
    </table></div>
  </section>
}

function OperatorComparison({ differences, operators }: { differences: ReturnType<typeof compareScheduleOperators>; operators: LicenseOperator[] }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const visible = differences.filter((item) => showUnchanged || item.status !== 'unchanged')
  const assignment = (entries: ScheduleAssignment[]) => entries.length ? <ul>{entries.map((entry, index) => <li key={index}>{text.assignment(entry.start, entry.end,
    entry.roomType === 'fiammetta' ? text.fiammetta : entry.roomType === 'fiammetta-target' ? manual.fiammettaTarget : `${ROOM_LABELS[entry.roomType] ?? entry.roomType} ${entry.roomIndex + 1}`)}</li>)}</ul> : text.notAssigned
  return <section className="v2-schedule-comparison-results" aria-label={text.operators}>
    <SectionTitle title={text.operators} description={text.operatorHint} />
    <Facts items={(['added', 'removed', 'changed', 'unchanged'] as const).map((status) => [text.statuses[status], differences.filter((item) => item.status === status).length])} />
    <label className="v2-schedule-comparison-toggle"><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} />{text.showUnchanged}</label>
    {!visible.length ? <Notice>{text.unchanged}</Notice> : <div className="v2-comparison-table v2-schedule-comparison-operators" role="region" aria-label={`${text.operators} · ${text.operator}`} tabIndex={0}><table>
      <thead><tr><th scope="col">{text.operator}</th><th scope="col">{text.status}</th><th scope="col">{text.before}</th><th scope="col">{text.after}</th></tr></thead>
      <tbody>{visible.map((item) => <tr key={item.name}><th scope="row"><OperatorAvatarTile operator={operators.find((operator) => operator.name === item.name) ?? { name: item.name }} compact showFullNames /></th><td>{text.statuses[item.status]}</td><td>{assignment(item.before)}</td><td>{assignment(item.after)}</td></tr>)}</tbody>
    </table></div>}
  </section>
}

function format(value: number | null | undefined, signed = false): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto' })
}
