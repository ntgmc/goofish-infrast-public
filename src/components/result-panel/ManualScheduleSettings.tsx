import { copy } from '../../copy/index'
import { isFiammettaShiftHoursSupported } from '../../lib/config'
import { changeManualFacility } from '../../lib/manual-schedule-tool'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { PRODUCT_LABELS, ROOM_LABELS } from './labels'

export default function ManualScheduleSettings({ result, operators, activePlan, onChange, onError }: {
  result: OptimizeResult; operators: LicenseOperator[]; activePlan: number;
  onChange: (source: OptimizeResult) => void; onError: (message: string) => void;
}) {
  const label = copy.tools.manualSchedule
  const plan = result.plans[activePlan]
  const fiammetta = operators.find((operator) => operator.own && (operator.id === 'char_300_phenxi' || operator.name === label.fiammettaName))
  const canUseFiammetta = Boolean(fiammetta && result.schedule_mode !== 'rotation' &&
    result.schedule_mode !== 'variable' && isFiammettaShiftHoursSupported(result.shift_hours))
  const targets = Object.entries(plan.rooms).filter(([type]) => type !== 'dormitory' && type !== 'training')
    .flatMap(([, rooms]) => rooms.flatMap((room) => room.operators ?? []))
    .filter((name) => name !== fiammetta?.name && operators.some((operator) => operator.own && operator.name === name))
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
      <div className="grid gap-4 border-t border-surface-3 pt-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{label.fiammetta}</p>
          <select aria-label={label.fiammettaTarget} className="tool-field"
            disabled={!canUseFiammetta && !plan.Fiammetta?.enable} value={plan.Fiammetta?.enable ? plan.Fiammetta.target : ''}
            onChange={(event) => changeFiammetta(event.target.value)}>
            <option value="">{label.fiammettaDisabled}</option>
            {plan.Fiammetta?.enable && !targets.includes(plan.Fiammetta.target) &&
              <option value={plan.Fiammetta.target} disabled>{plan.Fiammetta.target}</option>}
            {[...new Set(targets)].map((name) => <option key={name} value={name} disabled={!canUseFiammetta}>{name}</option>)}
          </select>
          <p className="text-xs leading-5 text-ink-muted">{canUseFiammetta ? label.fiammettaHint : label.fiammettaUnavailable}</p>
          <label className="block space-y-1 text-xs">
            <span>{label.fiammettaOrder}</span>
            <select aria-label={label.fiammettaOrder} className="tool-field" disabled={!plan.Fiammetta?.enable}
              value={plan.Fiammetta?.order ?? 'pre'} onChange={(event) => changeFiammetta(plan.Fiammetta?.target ?? '', event.target.value)}>
              <option value="pre">{label.pre}</option><option value="post">{label.post}</option>
            </select>
          </label>
        </div>
        <label className="block space-y-2 text-sm">
          <span>{label.droneOrder}</span>
          <select aria-label={label.droneOrder} className="tool-field" disabled={!plan.drones?.enable}
            value={plan.drones?.order ?? 'pre'} onChange={(event) => {
              const next = structuredClone(result)
              next.plans[activePlan].drones = { ...plan.drones!, order: event.target.value }
              onChange(next)
            }}>
            <option value="pre">{label.pre}</option><option value="post">{label.post}</option>
          </select>
        </label>
      </div>
    </section>
  )
}
