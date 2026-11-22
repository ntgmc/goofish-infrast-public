import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { copy } from '../../../copy'
import { ApiError, apiJson } from '../../../lib/api-client'
import { authPath } from '../../../lib/auth-navigation'
import { canonicalJson } from '../../../lib/crypto'
import { mergeOperators } from '../../../lib/license'
import { createManualPlans } from '../../../lib/manual-schedule'
import { getOptimizePollRetryDelayMs } from '../../../lib/optimize-poll'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { useTaskDraft } from '../../../lib/task-drafts'
import { personalValueClockSchema, valueClockComparisonSchema, type ValueClockComparison } from '../../../lib/value-clock-comparison'
import { isManualScheduleProfileAvailable } from '../../../lib/manual-schedule-tool'
import { useToolSession } from '../../tool/useToolSession'
import { useResultHistoryPagination } from '../../tool/optimize/useResultHistoryPagination'
import { useResultHistoryDetailQuery } from '../../tool/optimize/result-history-query'
import { cancelOptimizationJob, submitOptimizationJob } from '../../tool/optimize/optimization-api'
import { fetchOptimizeJobSnapshotStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, waitForOptimizePoll } from '../../tool/optimize/job-progress'
import { ScheduleSimulationProgress, scheduleSimulationStage, type ScheduleSimulationStage } from '../../../components/ScheduleSimulationProgress'
import type { OptimizeResult, UserWorkspace, LicenseOperator } from '../../../lib/types'
import { v2Path } from '../navigation'

const text = copy.optimizationGainClock
const format = (value: number, signed = false) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto' })
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

export default function OptimizationGainPersonal() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const session = useToolSession(params.get('profile_id'), true, false)
  const { features } = useSiteFeatures()
  const profiles = session.profiles.filter((profile) => profile.kind !== 'depot_value' && !profile.archived_at)
  const profile = session.activeProfile
  const operators = useMemo(() => mergeOperators(session.workspace?.operators ?? [], session.eliteOverrides), [session.workspace?.operators, session.eliteOverrides])
  return <section className="gain-personal" aria-labelledby="gain-personal-title">
    <h2 id="gain-personal-title">{text.personal}</h2>
    {session.authStatus === 'loading' ? <p role="status">{text.loading}</p>
      : session.authStatus === 'error' ? <p role="alert">{text.readFailed} <button type="button" className="value-clock-action" onClick={session.retryAuth}>{text.retry}</button></p>
        : !session.user ? <><p>{text.loginHint}</p><Link className="value-clock-action" to={authPath('login', `${location.pathname}${location.search}`)}>{text.login}</Link></>
          : !profiles.length ? <><p>{text.noProfile}</p><Link className="value-clock-action" to={v2Path('add-account')}>{text.addProfile}</Link></>
            : <>
              <div className="gain-personal-profile"><label className="gain-field"><span id="gain-profile-label">{text.profile}</span><select aria-labelledby="gain-profile-label" value={profile?.id ?? ''} onChange={(event) => setParams((current) => { const next = new URLSearchParams(current); next.set('profile_id', event.target.value); return next }, { replace: true })}><option value="" disabled>{text.selectProfile}</option>{profiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label><button type="button" className="value-clock-action" onClick={() => void session.handleLogout()}>{copy.v2.logout}</button></div>
              {session.workspaceLoadError && <p role="alert">{session.workspaceLoadError}</p>}
              {profile && !session.openingProfileId && <PersonalSettings key={`${session.user.id}:${profile.id}`} userId={session.user.id} profileId={profile.id} workspace={session.workspace} operators={operators}
                canCalculate={features.schedule_comparison && isManualScheduleProfileAvailable(profile)} />}
            </>}
  </section>
}

function PersonalSettings({ userId, profileId, workspace, operators, canCalculate }: { userId: string; profileId: string; workspace: UserWorkspace | null; operators: LicenseOperator[]; canCalculate: boolean }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['user', userId, profileId, 'value-clock-comparison'],
    queryFn: async ({ signal }) => personalValueClockSchema.parse(await apiJson<unknown>(`/api/user/value-clock/comparisons?profile_id=${encodeURIComponent(profileId)}`, { signal })), staleTime: 0 })
  const [editing, setEditing] = useState(false)
  const [selection, setSelection] = useState('')
  const history = useResultHistoryPagination(profileId, workspace, userId)
  const current = query.data?.current
  const candidates = [...history.resultHistory, ...history.archivedResults].filter((item) => current && item.id !== current.id && Date.parse(item.created_at) <= Date.parse(current.created_at))
  const selected = candidates.find((item) => item.id === selection)
  const comparison = query.data?.comparison
  return <>
    {query.isPending ? <p role="status">{text.loading}</p> : query.error ? <p role="alert">{text.readFailed} <button type="button" className="value-clock-action" onClick={() => void query.refetch()}>{text.retry}</button></p> : <>
      {comparison && <div className="gain-personal-active"><h3>{query.data?.comparison_state === 'active' ? text.active : text.ended}</h3><p>{comparison.baseline_name}</p><ComparisonValues comparison={comparison} />{comparison.confirmed_at && <p>{text.started}：<time dateTime={comparison.confirmed_at}>{time(comparison.confirmed_at)}</time></p>}{comparison.ends_at && <p>{text.ends}：<time dateTime={comparison.ends_at}>{time(comparison.ends_at)}</time></p>}{!editing && <button type="button" className="value-clock-action" onClick={() => setEditing(true)}>{text.change}</button>}</div>}
      {(!comparison || editing) && (!current ? <p>{text.noCurrent} <Link to={v2Path('generation', profileId)}>{text.generate}</Link></p> : <>
        <p>{text.personalHint}</p><p className="gain-current-plan">{text.currentPlan} <strong>{current.name}</strong></p>
        {!canCalculate ? <p>{text.permission}</p> : <>
          <label className="gain-field"><span id="gain-baseline-label">{text.selectBaseline}</span><select aria-labelledby="gain-baseline-label" value={selection} onChange={(event) => setSelection(event.target.value)}><option value="">{text.chooseBaseline}</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name} · {time(item.created_at)}</option>)}</select></label>
          {selected && <p className="gain-source-time">{text.sourceTime}：{time(selected.created_at)}</p>}
          {!candidates.length && <p>{text.noHistory} <Link to={v2Path('manual-tool', profileId)}>{text.manual}</Link></p>}
          {(history.resultHistoryHasMore || history.archivedResultsHasMore) && <div className="gain-personal-actions">{history.resultHistoryHasMore && <button type="button" className="value-clock-action" disabled={history.loadingScope !== null} onClick={() => void history.loadMoreResultHistory()}>{copy.optimize.pages_tool_optimize_result_history_load_more}</button>}{history.archivedResultsHasMore && <button type="button" className="value-clock-action" disabled={history.loadingScope !== null} onClick={() => void history.loadMoreArchivedResults()}>{copy.inventory.archive_title} · {copy.optimize.pages_tool_optimize_result_history_load_more}</button>}</div>}
          {history.error && <p role="alert">{history.error}</p>}
          {selection && <BaselineCalculation key={`${current.id}:${selection}:${canonicalJson(operators)}`} userId={userId} profileId={profileId} currentId={current.id} baselineId={selection} operators={operators} revision={query.data!.revision} config={workspace?.config ?? null} onSaved={() => { setEditing(false); void client.invalidateQueries({ queryKey: ['user', userId, profileId, 'value-clock-comparison'] }); void client.invalidateQueries({ queryKey: ['public', 'value-clock', 'gain'] }) }} />}
        </>}
      </>)}
    </>}
  </>
}

function BaselineCalculation({ userId, profileId, currentId, baselineId, operators, config, revision, onSaved }: { userId: string; profileId: string; currentId: string; baselineId: string; operators: LicenseOperator[]; config: UserWorkspace['config']; revision: number; onSaved: () => void }) {
  const current = useResultHistoryDetailQuery(userId, profileId, currentId)
  const baseline = useResultHistoryDetailQuery(userId, profileId, baselineId)
  const key = `gain-comparison:${userId}:${profileId}:${currentId}:${baselineId}:${canonicalJson(operators)}`
  const [jobs, setJobs] = useTaskDraft<Array<{ jobId: string; pollToken?: string } | null>>(`${key}:jobs`, [null, null])
  const [requestId, setRequestId] = useTaskDraft(`${key}:request`, () => crypto.randomUUID())
  const [verified, setVerified] = useState<ValueClockComparison | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [stage, setStage] = useState<{ side: number; stage: ScheduleSimulationStage } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const run = useRef(0), lock = useRef(false), activeJob = useRef<string | null>(null)
  const alive = useRef(true), cancelledByUser = useRef(false)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; run.current += 1; mutation.current?.abort() } }, [])

  async function calculate() {
    if (lock.current || !confirmed || !config || !current.data || !baseline.data) return
    lock.current = true; cancelledByUser.current = false
    const generation = ++run.current
    const cancelled = () => !alive.current || run.current !== generation
    const pendingJobs = jobs.slice()
    setError(null); setNotice(null); setVerified(null)
    try {
      for (const [side, source] of [current.data.result, baseline.data.result].entries()) {
        setStage({ side, stage: 'submitting' })
        if (!pendingJobs[side]) {
          const accepted = await submitOptimizationJob({ kind: 'schedule', identity: { type: 'profile', profileId }, operators,
            config, includeUpgradeSuggestions: false, manualSchedule: { source, plans: createManualPlans(source), purpose: 'comparison' } }, text.failed, `${requestId}:${side}`)
          if (cancelled()) { if (cancelledByUser.current) await cancelOptimizationJob(accepted.job_id); return }
          pendingJobs[side] = { jobId: accepted.job_id, pollToken: accepted.poll_token }
          setJobs(pendingJobs.slice())
        }
        const pendingJob = pendingJobs[side]!
        activeJob.current = pendingJob.jobId
        let failures = 0
        while (!cancelled()) {
          try {
            const job = await fetchOptimizeJobSnapshotStatus<OptimizeResult>(pendingJob.jobId, text.failed, pendingJob.pollToken, cancelled)
            if (cancelled()) return
            failures = 0
            if (job.status === 'succeeded') break
            if (job.status !== 'queued' && job.status !== 'running') { setJobs([null, null]); setRequestId(crypto.randomUUID()); throw new Error(job.error.message) }
            setStage({ side, stage: scheduleSimulationStage(job) })
            await waitForOptimizePoll(job.pollAfterMs ?? 1000, cancelled)
          } catch (cause) {
            if (isOptimizeJobPollCancelled(cause) || cancelled()) return
            if (!isRetryableOptimizePollError(cause)) throw cause
            setStage({ side, stage: 'reconnecting' })
            await waitForOptimizePoll(getOptimizePollRetryDelayMs(++failures), cancelled)
          }
        }
        if (cancelled()) return
      }
      activeJob.current = null
      mutation.current = new AbortController()
      const result = valueClockComparisonSchema.parse(await apiJson<unknown>('/api/user/value-clock/comparisons', { method: 'POST', signal: mutation.current.signal, json: {
        action: 'verify', profile_id: profileId, current_result_id: currentId, baseline_result_id: baselineId,
        current_job_id: pendingJobs[0]!.jobId, baseline_job_id: pendingJobs[1]!.jobId, confirmed_previous_plan: true, request_id: requestId,
      }, fallbackMessage: text.verifyFailed }))
      if (!cancelled()) setVerified(result)
    } catch (cause) { if (!cancelled()) { if (cause instanceof ApiError && cause.code === 'comparison_reassessment_required') { setJobs([null, null]); setRequestId(crypto.randomUUID()) }; setError(cause instanceof Error ? cause.message : text.failed) } }
    finally { if (!cancelled()) { setStage(null); lock.current = false; activeJob.current = null } }
  }
  async function cancel() {
    const id = activeJob.current
    cancelledByUser.current = true
    run.current += 1
    mutation.current?.abort()
    setStage(null); lock.current = false; activeJob.current = null
    if (id) {
      try { await cancelOptimizationJob(id) } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : text.failed); return }
    }
    if (alive.current) { setJobs([null, null]); setRequestId(crypto.randomUUID()); setNotice(text.cancelHint) }
  }
  async function activate() {
    if (!verified || saving) return
    setSaving(true); setError(null)
    mutation.current = new AbortController()
    try {
      await apiJson('/api/user/value-clock/comparisons', { method: 'POST', signal: mutation.current.signal, json: { action: 'activate', profile_id: profileId, comparison_id: verified.id, revision }, fallbackMessage: text.verifyFailed })
      if (alive.current) { setNotice(text.saved); onSaved() }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : text.verifyFailed) }
    finally { if (alive.current) setSaving(false) }
  }
  return <div className="gain-calculation">
    {(current.error || baseline.error) && <p role="alert">{text.readFailed} <button type="button" className="value-clock-action" onClick={() => { void current.refetch(); void baseline.refetch() }}>{text.retry}</button></p>}
    <label className="gain-confirmation"><input type="checkbox" checked={confirmed} disabled={Boolean(stage) || saving} onChange={(event) => setConfirmed(event.target.checked)} /><span>{text.confirmation}</span></label>
    <p>{text.reassessHint}</p>
    <div className="gain-personal-actions"><button type="button" className="value-clock-action gain-primary" disabled={!confirmed || !config || !current.data || !baseline.data || Boolean(stage) || saving} onClick={() => void calculate()}>{text.reassess}</button>{stage && <button type="button" className="value-clock-action" onClick={() => void cancel()}>{text.cancel}</button>}</div>
    {stage && <ScheduleSimulationProgress stage={stage.stage} side={stage.side} steps={[text.current, text.baseline].map((label, side) => ({ label, complete: side < stage.side }))} />}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {verified && <div className="gain-verified"><h3>{text.verified}</h3><ComparisonValues comparison={verified} /><p>{text.activateHint}</p><button type="button" className="value-clock-action gain-primary" disabled={saving || !confirmed} onClick={() => void activate()}>{saving ? text.activating : text.activate}</button></div>}
  </div>
}
function ComparisonValues({ comparison }: { comparison: ValueClockComparison }) {
  return <dl className="gain-personal-values"><div><dt>{text.current}</dt><dd>{format(comparison.current_daily_sanity)}</dd></div><div><dt>{text.baseline}</dt><dd>{format(comparison.baseline_daily_sanity)}</dd></div><div><dt>{text.daily}</dt><dd data-negative={comparison.daily_gain_sanity < 0 || undefined}>{format(comparison.daily_gain_sanity, true)}</dd></div><div className="gain-personal-unit">{text.perDay}</div></dl>
}
