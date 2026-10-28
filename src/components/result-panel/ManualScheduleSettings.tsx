import { useState } from 'react'
import { copy } from '../../copy/index'
import { isFiammettaShiftHoursSupported } from '../../lib/config'
import { changeManualFacility } from '../../lib/manual-schedule-tool'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { PRODUCT_LABELS, ROOM_LABELS } from './labels'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { OperatorAvatarTile } from './OperatorAvatarStrip'
import ManualOperatorPicker from './ManualOperatorPicker'
import { createManualPlans } from '../../lib/manual-schedule'

export default function ManualScheduleSettings({ result, operators, activePlan, onChange, onError }: {
  result: OptimizeResult; operators: LicenseOperator[]; activePlan: number;
  onChange: (source: OptimizeResult) => void; onError: (message: string) => void;
}) {
  const label = copy.tools.manualSchedule
  const plan = result.plans[activePlan]
  const fiammetta = operators.find((operator) => operator.own && (operator.id === 'char_300_phenxi' || operator.name === label.fiammettaName))
  const canUseFiammetta = Boolean(fiammetta && result.schedule_mode !== 'rotation' &&
    result.schedule_mode !== 'variable' && isFiammettaShiftHoursSupported(result.shift_hours))
  const [choosingTarget, setChoosingTarget] = useState(false)
  const target = plan.Fiammetta?.enable ? plan.Fiammetta.target : ''
  const targetOperator = operators.find((operator) => operator.name === target)
  function changeFacility(type: string, index: number, settings: { level?: number; product?: string }) {
    try { onChange(changeManualFacility(result, type, index, settings)) }
    catch (cause) { onError(cause instanceof Error ? cause.message : label.invalidSettings) }
  }
  function changeFiammetta(target: string, order = plan.Fiammetta?.order ?? 'pre') {
    const next = structuredClone(result)
    next.plans[activePlan].Fiammetta = { enable: Boolean(target), target, order }
    onChange(next)
  }
  return (
    <section className="tool-panel space-y-4 p-4" aria-label={label.settings}>
      <h3 className="font-semibold">{label.settings}</h3>
      <details open>
        <summary className="cursor-pointer text-sm font-medium">{label.facilities}</summary>
        <p className="my-3 text-xs leading-5 text-ink-muted">{label.facilitiesHint}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(plan.rooms).flatMap(([type, rooms]) => rooms.map((room, index) => {
            const name = `${ROOM_LABELS[type] ?? copy.domain.building_skills.training} ${index + 1}`
            const products = type === 'trading' ? ['LMD', 'Orundum'] : type === 'manufacture' ? ['Pure Gold', 'Battle Record', 'Originium Shard'] : []
            return (
              <div key={`${type}:${index}`} className="tool-inset space-y-2 p-3">
                <p className="text-sm font-medium">{name}</p>
                <label className="flex items-center justify-between gap-3 text-xs">
                  <span>{label.level}</span>
                  <select aria-label={`${name} · ${label.level}`} className="tool-field w-20" value={room.level ?? (type === 'control' || type === 'dormitory' ? 5 : 3)}
                    onChange={(event) => changeFacility(type, index, { level: Number(event.target.value) })}>
                    {Array.from({ length: type === 'control' || type === 'dormitory' ? 5 : 3 }, (_, level) =>
                      <option key={level} value={level + 1}>{level + 1}</option>)}
                  </select>
                </label>
                {products.length > 0 && <label className="block space-y-1 text-xs">
                  <span>{label.product}</span>
                  <select aria-label={`${name} · ${label.product}`} className="tool-field" value={room.product ?? (type === 'trading' ? 'LMD' : 'Battle Record')}
                    onChange={(event) => changeFacility(type, index, { product: event.target.value })}>
                    {products.map((product) => <option key={product} value={product}>{PRODUCT_LABELS[product]}</option>)}
                  </select>
                </label>}
              </div>
            )
          }))}
        </div>
      </details>
      <div className="space-y-3 border-t border-surface-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">{label.fiammetta}</p>
          <button type="button" className="tool-secondary-action min-h-11" aria-label={label.fiammettaTarget}
            aria-description={target || label.fiammettaDisabled}
            disabled={!canUseFiammetta && !target} onClick={() => setChoosingTarget(true)}>
            {target ? <OperatorAvatarTile operator={targetOperator ?? { name: target }} compact showFullNames buttonChild /> : label.fiammettaDisabled}
          </button>
        </div>
        {!canUseFiammetta && <p className="text-xs leading-5 text-ink-muted">{label.fiammettaUnavailable}</p>}
        {(plan.drones?.enable || plan.Fiammetta?.enable) && <details className="tool-inset px-3 py-2">
          <summary className="cursor-pointer text-xs leading-6 text-ink-secondary">{label.timingSettings}</summary>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
            {plan.Fiammetta?.enable && <fieldset>
              <legend className="text-xs text-ink-muted">{label.fiammettaOrder}</legend>
              <div className="flex gap-4">
                {(['pre', 'post'] as const).map((order) => <label key={order} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name={`fiammetta-order-${activePlan}`} className="accent-brand-500"
                    checked={plan.Fiammetta?.order === order} onChange={() => changeFiammetta(target, order)} />
                  {label[order]}
                </label>)}
              </div>
            </fieldset>}
            {plan.drones?.enable && <fieldset>
              <legend className="text-xs text-ink-muted">{label.droneOrder}</legend>
              <div className="flex gap-4">
                {(['pre', 'post'] as const).map((order) => <label key={order} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name={`drone-order-${activePlan}`} className="accent-brand-500"
                    checked={plan.drones?.order === order} onChange={() => {
                      const next = structuredClone(result)
                      next.plans[activePlan].drones = { ...plan.drones!, order }
                      onChange(next)
                    }} />
                  {label[order]}
                </label>)}
              </div>
            </fieldset>}
          </div>
        </details>}
      </div>
      <Dialog open={choosingTarget} onOpenChange={setChoosingTarget}>
        <DialogContent className="max-w-3xl" showCloseButton closeLabel={copy.domain.manual_schedule.close}>
          <DialogTitle>{label.fiammettaTarget}</DialogTitle>
          <DialogDescription>{label.fiammettaHint}</DialogDescription>
          <ManualOperatorPicker operators={canUseFiammetta ? operators : []} locked={new Set(fiammetta ? [fiammetta.name] : [])}
            rooms={createManualPlans(result)[activePlan].rooms} roomType="" selectedName={target}
            onChoose={(name) => { changeFiammetta(name); setChoosingTarget(false) }} />
          <div className="flex flex-wrap justify-between gap-3 border-t border-surface-3 pt-3">
            <button type="button" className="tool-secondary-action" disabled={!target}
              onClick={() => { changeFiammetta(''); setChoosingTarget(false) }}>{label.fiammettaDisabled}</button>
            <DialogClose className="tool-primary-action">{copy.domain.manual_schedule.done}</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
