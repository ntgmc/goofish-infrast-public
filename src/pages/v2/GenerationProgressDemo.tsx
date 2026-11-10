import { useCallback, useEffect, useMemo, useState } from 'react'
import { CloseIcon, PreviewIcon } from '../../components/icons'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import type { ScheduleProgressState } from '../../components/ScheduleProgress'
import { getScheduleProgressPercent } from '../../components/schedule-progress-model'
import { copy } from '../../copy'
import { adminApiJson, ADMIN_SESSION_EXPIRED_EVENT } from '../../lib/admin-api-client'
import V2GenerationProgress from './V2GenerationProgress'

const text = copy.v2.progressDemo
const stages = {
  queued: { duration: 1800, progress: { queueStatus: 'queued', queuePosition: 3, observedRunning: false, estimatePhase: 'queued', executionPhase: 'initial_queue', percentFloor: 2 } },
  schedule: { duration: 4500, progress: { calculationStage: 'generating_schedule', percentFloor: 22 } },
  suggestions: { duration: 3500, progress: { calculationStage: 'simulating_upgrades', percentFloor: 74 } },
  saving: { duration: 1600, progress: { calculationStage: 'persisting_result', executionPhase: 'settling', percentFloor: 95 } },
  reconnecting: { duration: 2500, progress: { calculationStage: 'generating_schedule', connectionStatus: 'reconnecting', percentFloor: 40 } },
  cancelling: { duration: 1000, progress: { calculationStage: 'generating_schedule', cancellationRequested: true, percentFloor: 45 } },
  cancelled: { duration: 0, progress: { estimatePhase: 'cancelled', executionPhase: 'terminal', percentFloor: 45 } },
  failed: { duration: 0, progress: { estimatePhase: 'failed', executionPhase: 'terminal', percentFloor: 45 } },
  completed: { duration: 0, progress: { estimatePhase: 'completed', executionPhase: 'terminal', calculationStage: 'completed', estimatedRemainingMs: 0, percentFloor: 100 } },
} satisfies Record<string, { duration: number; progress: Partial<ScheduleProgressState> }>

const scenarios = {
  normal: ['queued', 'schedule', 'suggestions', 'saving', 'completed'],
  quick: ['queued', 'schedule', 'saving', 'completed'],
  reconnect: ['queued', 'schedule', 'reconnecting', 'schedule', 'suggestions', 'saving', 'completed'],
  failed: ['queued', 'schedule', 'failed'],
  cancelled: ['queued', 'schedule', 'cancelling', 'cancelled'],
} satisfies Record<string, Array<keyof typeof stages>>
type Scenario = keyof typeof scenarios

export default function GenerationProgressDemo() {
  const [open, setOpen] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  useEffect(() => {
    let active = true
    const hide = () => { if (active) { setAuthorized(false); setOpen(false) } }
    const check = () => {
      void adminApiJson<{ user?: { username?: unknown } }>('/api/admin/session')
        .then(({ user }) => {
          if (!active) return
          if (typeof user?.username === 'string' && user.username) setAuthorized(true)
          else hide()
        }).catch(hide)
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, hide)
    return () => {
      active = false
      window.removeEventListener('focus', check)
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, hide)
    }
  }, [])
  if (!authorized) return null
  return <>
    <button type="button" className="v2-text-button" onClick={() => setOpen(true)}><PreviewIcon size={16} aria-hidden="true" />{text.open}</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="v2-dialog v2-modal v2-progress-demo">
        <header className="v2-modal-heading"><DialogTitle>{text.title}</DialogTitle><DialogDescription>{text.description}</DialogDescription></header>
        {open && <DemoPlayer />}
        <DialogClose className="v2-text-button v2-modal-close" aria-label={copy.v2.close}><CloseIcon size={20} aria-hidden="true" /></DialogClose>
      </DialogContent>
    </Dialog>
  </>
}

function DemoPlayer() {
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [frame, setFrame] = useState(() => createFrame(0))
  const steps = scenarios[scenario]
  const name = steps[frame.index]
  const stage = stages[name]
  const progress = useMemo<ScheduleProgressState>(() => ({
    mode: 'generate', jobId: `demo-${frame.run}`, startedAt: frame.startedAt,
    lastUpdatedAt: frame.at, estimateUpdatedAt: new Date(frame.at).toISOString(),
    calculationStageUpdatedAt: new Date(frame.at).toISOString(),
    queueStatus: 'running', observedRunning: true, estimatePhase: 'running', executionPhase: 'executing',
    connectionStatus: 'connected', upgradeSuggestionsRequested: true, upgradeSuggestionsAllowed: true,
    estimatedRemainingMs: Math.max(1000, 15_000 - (frame.at - frame.startedAt)),
    ...stage.progress,
    percentFloor: Math.max(frame.floor, stage.progress.percentFloor),
    ...(name === 'completed' ? { completedAt: frame.at } : {}),
  }), [frame, name, stage])
  const advance = useCallback(() => {
    const now = Date.now()
    setFrame((current) => ({ ...current, index: Math.min(current.index + 1, steps.length - 1), at: now, floor: getScheduleProgressPercent(progress, now) }))
  }, [progress, steps.length])
  useEffect(() => {
    if (!stage.duration) return
    const timer = window.setTimeout(advance, scenario === 'quick' ? 250 : stage.duration)
    return () => window.clearTimeout(timer)
  }, [advance, scenario, stage.duration])
  function restart(next: Scenario = scenario) {
    setScenario(next)
    setFrame((current) => createFrame(current.run + 1))
  }
  return <div className="v2-modal-body">
    <div className="v2-progress-demo-controls">
      <label className="v2-field"><span>{text.scenario}</span><select className="v2-input" value={scenario} onChange={(event) => restart(event.target.value as Scenario)}>
        {(Object.keys(scenarios) as Scenario[]).map((value) => <option key={value} value={value}>{text.scenarios[value]}</option>)}
      </select></label>
      <div className="v2-actions">
        <button type="button" className="v2-button v2-button-secondary" onClick={() => restart()}>{text.restart}</button>
        <button type="button" className="v2-button v2-button-secondary" onClick={advance} disabled={frame.index === steps.length - 1}>{text.next}</button>
      </div>
    </div>
    <V2GenerationProgress key={frame.run} progress={progress} resultReady={name === 'completed'}>
      {name === 'completed' && <section className="v2-notice" aria-label={text.completed} role="status"><div><h3>{text.completed}</h3><p>{text.result}</p></div></section>}
    </V2GenerationProgress>
  </div>
}

function createFrame(run: number) {
  const now = Date.now()
  return { run, index: 0, startedAt: now, at: now, floor: 0 }
}
