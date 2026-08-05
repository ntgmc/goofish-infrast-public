import { useEffect, useState } from 'react'
import { copy } from '../copy/index'
import {
  clearDebugEvents,
  disableDebugMode,
  downloadDebugData,
  enableDebugMode,
  getDebugDiagnosticsSnapshot,
  subscribeDebugDiagnostics,
} from '../lib/debug-diagnostics'

export default function DebugModePanel() {
  const [snapshot, setSnapshot] = useState(getDebugDiagnosticsSnapshot)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeDebugDiagnostics(() => setSnapshot(getDebugDiagnosticsSnapshot())), [])

  const refresh = () => setSnapshot(getDebugDiagnosticsSnapshot())
  const enable = () => {
    setError(null)
    setNotice(null)
    if (!enableDebugMode()) {
      setError(copy.debug.storage_unavailable)
      refresh()
      return
    }
    setNotice(copy.debug.enabled_notice)
    refresh()
  }
  const clear = () => {
    if (!window.confirm(copy.debug.clear_confirm)) return
    setError(null)
    setNotice(null)
    if (!clearDebugEvents()) {
      setError(copy.debug.clear_failed)
      refresh()
      return
    }
    setNotice(copy.debug.cleared_notice)
    refresh()
  }
  const disable = () => {
    setError(null)
    setNotice(null)
    if (!disableDebugMode()) {
      setError(copy.debug.disable_failed)
      refresh()
      return
    }
    setNotice(copy.debug.disabled_notice)
    refresh()
  }
  const exportData = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await downloadDebugData()
      setNotice(copy.debug.export_success)
    } catch {
      setError(copy.debug.export_failed)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <section className="tool-panel p-6" aria-labelledby="debug-mode-title">
      <h2 id="debug-mode-title" className="text-lg font-semibold text-ink-primary">{copy.debug.title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.debug.description}</p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">{copy.debug.privacy}</p>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
      <div className="tool-inset mt-5 p-4">
        <p className="text-sm font-medium text-ink-primary">
          {snapshot.enabled ? copy.debug.enabled_status : copy.debug.disabled_status}
        </p>
        {snapshot.enabled && (
          <p className="mt-1 text-xs text-ink-muted">{copy.debug.event_count(snapshot.eventCount)}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {snapshot.enabled ? (
            <>
              <button type="button" className="tool-primary-action" onClick={() => void exportData()} disabled={busy}>
                {busy ? copy.debug.exporting : copy.debug.export}
              </button>
              <button type="button" className="tool-secondary-action" onClick={clear} disabled={busy}>{copy.debug.clear}</button>
              <button type="button" className="tool-secondary-action" aria-pressed="true" onClick={disable} disabled={busy}>{copy.debug.disable}</button>
            </>
          ) : (
            <button type="button" className="tool-primary-action" aria-pressed="false" onClick={enable} disabled={busy}>
              {copy.debug.enable}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
