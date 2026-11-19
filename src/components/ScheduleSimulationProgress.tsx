import { useEffect, useRef } from 'react'
import { copy } from '../copy'
import type { OptimizationJobSnapshot } from '../lib/optimization-contracts'
import type { OptimizeJobAccepted } from '../lib/types'
import { SuccessIcon } from './icons'
import './ScheduleSimulationProgress.css'

const text = copy.domain.schedule_simulation
export type ScheduleSimulationStage = 'submitting' | 'queued' | 'retry' | 'running' | 'saving' | 'reconnecting'

type SimulationJob = Pick<OptimizeJobAccepted, 'status' | 'calculation_stage'> | Pick<OptimizationJobSnapshot, 'status' | 'executionPhase' | 'calculationStage'>

export function scheduleSimulationStage(job: SimulationJob): ScheduleSimulationStage {
  if (job.status === 'queued') return 'executionPhase' in job && job.executionPhase === 'retry_wait' ? 'retry' : 'queued'
  const stage = 'calculationStage' in job ? job.calculationStage : job.calculation_stage
  return stage === 'persisting_result' ? 'saving' : 'running'
}

export function ScheduleSimulationProgress({ stage, steps, side }: {
  stage: ScheduleSimulationStage
  steps?: readonly { label: string; complete: boolean }[]
  side?: number
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = panel.current
    if (element?.getClientRects().length) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  }, [])

  const hint = text.hints[stage] ?? (steps ? text.compareHint : text.manualHint)
  const current = side === undefined ? undefined : steps?.[side]?.label
  return <div ref={panel} className="schedule-simulation-progress" data-stage={stage}>
    <div className="schedule-simulation-current">
      <div className="schedule-simulation-mark" aria-hidden="true"><i /><i /><i /></div>
      <div className="schedule-simulation-message">
        <div role="status" aria-atomic="true" className="schedule-simulation-title">
          {current && <span className="sr-only">{current} · </span>}<strong>{stage === 'running' && !steps ? text.runningManual : text[stage]}</strong>
        </div>
        <p>{hint}</p>
      </div>
    </div>
    {steps && <ol className="schedule-simulation-steps">
      {steps.map(({ label, complete }, index) => <li key={label} aria-current={index === side ? 'step' : undefined} data-complete={complete || undefined}>
        <span>{complete && <SuccessIcon size={15} aria-hidden="true" />}{label}</span><small>{complete ? text.complete : index === side ? text.active : text.pending}</small>
      </li>)}
    </ol>}
  </div>
}
