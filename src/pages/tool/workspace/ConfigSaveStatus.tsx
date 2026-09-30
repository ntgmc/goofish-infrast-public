import { copy } from '../../../copy/index'
import type { ConfigSyncStatus } from '../useToolSession'

export default function ConfigSaveStatus({ status, onRetry }: {
  status: ConfigSyncStatus | null
  onRetry: () => void
}) {
  if (status === 'failed') {
    return <button type="button" onClick={onRetry} className="tool-status tool-status--error">{copy.workspace.config_save_failed}</button>
  }
  return (
    <span role="status" aria-live="polite" className={`tool-status${status === 'idle' ? ' tool-status--success' : ' tool-status--warning'}`}>
      {status === 'idle' ? copy.workspace.config_saved
        : status === 'saving' ? copy.workspace.config_saving
          : status === 'pending' ? copy.workspace.config_save_pending
            : copy.workspace.config_not_saved}
    </span>
  )
}
