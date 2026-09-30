import { Drone } from 'lucide-react'
import type { DroneAssignment } from '../../lib/types'
import { copy } from '../../copy/index'

export function isDroneTarget(drones: DroneAssignment | undefined, roomType: string, roomIndex: number): boolean {
  return drones?.enable === true && drones.room === roomType && drones.index === roomIndex + 1
}

export default function DroneMarker({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null
  const label = copy.domain.manual_schedule.drone_marker(labels.join('、'))
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 p-1 text-brand-400" role="img" aria-label={label} title={label}>
      <Drone size={18} aria-hidden="true" />
      {labels.length > 1 && <span className="text-[10px] font-semibold">{labels.length}</span>}
    </span>
  )
}
