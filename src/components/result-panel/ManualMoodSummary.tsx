import type { OptimizeResult } from '../../lib/types'
import { copy } from '../../copy/index'
import { formatCompactNumber } from './formatters'
import { ROOM_LABELS } from './labels'

export default function ManualMoodSummary({ result, activePlan, onPlanChange, onFill, filling }: {
  result: OptimizeResult;
  activePlan: number;
  onPlanChange: (index: number) => void;
  onFill: () => void;
  filling: boolean;
}) {
  const label = copy.domain.manual_schedule
  const simulation = result.mood_simulation
  if (!simulation) return null
  const rows = result.plans.flatMap((plan, shiftIndex) =>
    Object.entries(plan.rooms).flatMap(([type, rooms]) =>
      type === 'dormitory' ? [] : rooms.flatMap((room, roomIndex) =>
        Object.entries(room.mood ?? {}).flatMap(([operator, mood]) =>
          typeof mood.start !== 'number' || typeof mood.consumed !== 'number' || typeof mood.end !== 'number' ? [] : [{
          key: `${shiftIndex}:${type}:${roomIndex}:${operator}`,
          shiftIndex, shift: plan.name, operator, mood: { ...mood, start: mood.start, consumed: mood.consumed, end: mood.end },
          facility: `${ROOM_LABELS[type] ?? type} ${roomIndex + 1}`,
        }]))))
  const problems = rows.filter(({ mood }) => mood.red_face)
  const affected = [...new Set([
    ...problems.map(({ operator }) => operator),
    ...simulation.degrading_operators.map(({ operator }) => operator),
  ])]
  const recovery = simulation.dormitory_recovery
  const rotation = result.schedule_mode === 'rotation'

  return <section className="tool-panel space-y-4 p-4 sm:p-5" aria-label={label.mood_title}>
    <h3 className="text-lg font-semibold">{label.mood_title}</h3>
    <div className={`tool-alert space-y-2 p-4 text-sm ${simulation.valid ? 'tool-alert--success' : 'tool-alert--warning'}`} role="status">
      <p className="font-semibold">{rotation ? label.mood_rotation : simulation.valid ? label.mood_stable : label.mood_warning}</p>
      {affected.length > 0 && <p className="font-semibold">{label.mood_affected(affected.join('、'))}</p>}
      {problems.length > 0 && <ul className="space-y-1">
        {problems.map(({ key, operator, shift, facility, mood }) => <li key={key}>
          <strong>{operator}</strong> · {shift} · {facility} · {label.mood_shortfall(formatCompactNumber(Math.max(0, mood.consumed - mood.start)))}
        </li>)}
      </ul>}
      {simulation.degrading_operators.length > 0 && <p>{label.mood_degrading(simulation.degrading_operators
        .map(({ operator, start, end }) => `${operator}（${formatCompactNumber(start)} → ${formatCompactNumber(end)}）`).join('、'))}</p>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label={copy.domain.result_board_v2.shifts}>
      {result.plans.map((plan, index) => <button key={index} type="button"
        className={activePlan === index ? 'tool-primary-action' : 'tool-secondary-action'}
        aria-pressed={activePlan === index} onClick={() => onPlanChange(index)}>{plan.name}</button>)}
    </div>
    {rows.some(({ shiftIndex }) => shiftIndex === activePlan) ? <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="sr-only">{result.plans[activePlan]?.name} · {label.mood_title}</caption>
        <thead className="text-ink-muted"><tr>
          {[label.mood_operator, label.mood_start, label.mood_consumed, label.mood_end, label.mood_status].map((title) =>
            <th key={title} scope="col" className="px-2 py-2 font-medium">{title}</th>)}
        </tr></thead>
        <tbody>{rows.filter(({ shiftIndex }) => shiftIndex === activePlan).map(({ key, operator, facility, mood }) =>
          <tr key={key} className={`border-t border-surface-3 ${mood.red_face ? 'bg-warning/10 text-warning' : ''}`}>
            <th scope="row" className="px-2 py-3 font-semibold">{operator}<span className="block text-xs font-normal text-ink-muted">{facility}</span></th>
            <td className="px-2 py-3 tabular-nums">{formatCompactNumber(mood.start)} / 24</td>
            <td className="px-2 py-3 tabular-nums">{formatCompactNumber(mood.consumed)}</td>
            <td className="px-2 py-3 tabular-nums">
              {formatCompactNumber(mood.end)} / 24
              <progress className="mt-1 block h-1.5 w-20 accent-brand-500" max={24} value={Math.max(0, mood.end)}
                aria-label={`${operator} · ${label.mood_end}`} />
            </td>
            <td className="px-2 py-3">{mood.red_face
              ? label.mood_shortfall(formatCompactNumber(Math.max(0, mood.consumed - mood.start)))
              : label.mood_sufficient}</td>
          </tr>)}</tbody>
      </table>
    </div> : <p className="text-sm text-ink-muted">{label.mood_empty}</p>}
    {recovery && <div className="space-y-3 border-t border-surface-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">{label.dormitory_title}</h4>
        <button type="button" className="tool-primary-action" disabled={filling || recovery.additions.length === 0}
          onClick={onFill}>{label.dormitory_fill}</button>
      </div>
      <p className="text-sm text-ink-muted">{label.dormitory_hint}</p>
      {recovery.additions.length > 0 ? <>
        <p className="text-sm font-medium">{label.dormitory_suggestions(recovery.additions.length)}</p>
        <ul className="flex flex-wrap gap-2 text-sm">{recovery.additions.map(({ shift_index, room_index, operator }) =>
          <li key={`${shift_index}:${operator}`} className="rounded-md bg-surface-2 px-3 py-2">
            {label.dormitory_destination(result.plans[shift_index]?.name ?? '', room_index + 1, operator)}
          </li>)}</ul>
      </> : recovery.unassigned.length === 0 && <p className="text-sm text-ink-muted">{label.dormitory_no_need}</p>}
      {recovery.unassigned.length > 0 && <div className="tool-alert tool-alert--warning p-3 text-sm">
        <p className="font-semibold">{label.dormitory_unassigned}</p>
        <ul>{recovery.unassigned.map(({ shift_index, operator }) =>
          <li key={`${shift_index}:${operator}`}>{result.plans[shift_index]?.name} · {operator}</li>)}</ul>
      </div>}
    </div>}
  </section>
}
