import type { DroneAssignment } from '../../lib/types'
import { DRONE_REASON_LABELS, ROOM_LABELS } from './labels'
import { formatPercent, formatProduct } from './formatters'
import { copy } from '../../copy/index'


export default function DroneSummary({ drones }: { drones: DroneAssignment }) {
  const roomLabel = ROOM_LABELS[drones.room] || drones.room
  const reason = drones.reason ? DRONE_REASON_LABELS[drones.reason] ?? drones.reason : ''

  return (
    <div className="mt-3 border-t border-surface-3/50 pt-3">
      <div className="tool-inset flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tool-status tool-status--current">
              {drones.mode === 'auto' ? copy.domain.components_result_panel_DroneSummary_001 : copy.domain.components_result_panel_DroneSummary_002}
            </span>
            <span className="text-sm font-medium text-ink-primary">
              {roomLabel} {drones.index}
              {drones.product && ` · ${formatProduct(drones.product)}`}
            </span>
          </div>
          {reason && (
            <p className="mt-1 text-xs text-ink-muted">
              {reason}
              {drones.candidate_count ? `${copy.domain.components_result_panel_DroneSummary_003}${drones.candidate_count}${copy.domain.components_result_panel_DroneSummary_004}` : ''}
            </p>
          )}
        </div>
        <div className="text-left sm:text-right">
          {typeof drones.display_efficiency === 'number' && (
            <p className="text-sm font-semibold text-brand-400">{formatPercent(drones.display_efficiency)}</p>
          )}
          <p className="text-xs text-ink-muted">
            {drones.order}
            {typeof drones.efficiency === 'number' && drones.efficiency !== drones.display_efficiency
              ? `${copy.domain.components_result_panel_DroneSummary_005}${formatPercent(drones.efficiency)}`
              : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
