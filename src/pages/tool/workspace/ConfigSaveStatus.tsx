import { copy } from '../../../copy/index'
import type { ConfigSyncStatus } from '../useToolSession'

export default function ConfigSaveStatus({ status, onRetry, sample = false, compact = false }: {
  status: ConfigSyncStatus | null
  onRetry: () => void
  sample?: boolean
  compact?: boolean
}) {
  if (sample) {
    return <span role="status" aria-live="polite" className="tool-status">{copy.workspace.config_sample}</span>
  }
  if (status === 'failed') {
    return <button type="button" onClick={onRetry} className="tool-status tool-status--error">{compact ? copy.workspace.config_save_failed_short : copy.workspace.config_save_failed}</button>
  }
  return (
    <span role="status" aria-live="polite" className={`tool-status${status === 'idle' ? ' tool-status--success' : ' tool-status--warning'}`}>
      {status === 'idle' ? compact ? copy.workspace.config_saved_short : copy.workspace.config_saved
        : status === 'saving' ? compact ? copy.workspace.config_saving_short : copy.workspace.config_saving
          : status === 'pending' ? compact ? copy.workspace.config_save_pending_short : copy.workspace.config_save_pending
            : copy.workspace.config_not_saved}
    </span>
  )
}
