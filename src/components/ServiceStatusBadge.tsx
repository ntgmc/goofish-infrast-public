import { CircleAlert, CircleCheck, CircleX, RefreshCw } from 'lucide-react'
import { copy } from '../copy/index'
import type { ServiceStatusLevel } from '../lib/service-status'

const STATUS_LABELS: Record<ServiceStatusLevel, string> = {
  available: copy.status.serviceStatus_available,
  scaling: copy.status.serviceStatus_scaling,
  busy: copy.status.serviceStatus_busy,
  congested: copy.status.serviceStatus_congested,
  overloaded: copy.status.serviceStatus_overloaded,
  unavailable: copy.status.serviceStatus_unavailable,
}

const STATUS_COMPONENT_LABELS: Record<ServiceStatusLevel, string> = {
  available: copy.status.serviceStatus_component_available,
  scaling: copy.status.serviceStatus_component_scaling,
  busy: copy.status.serviceStatus_component_busy,
  congested: copy.status.serviceStatus_component_congested,
  overloaded: copy.status.serviceStatus_component_overloaded,
  unavailable: copy.status.serviceStatus_component_unavailable,
}

export default function ServiceStatusBadge({ level, compact = false }: { level: ServiceStatusLevel; compact?: boolean }) {
  const Icon = level === 'unavailable' ? CircleX : level === 'available' || level === 'busy' ? CircleCheck : level === 'scaling' ? RefreshCw : CircleAlert
  return (
    <span className={`service-status-badge service-status-badge--${level} ${compact ? 'service-status-badge--compact' : ''}`}>
      <Icon aria-hidden="true" className={`size-4 shrink-0 ${level === 'scaling' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <span>{compact ? STATUS_COMPONENT_LABELS[level] : STATUS_LABELS[level]}</span>
    </span>
  )
}
