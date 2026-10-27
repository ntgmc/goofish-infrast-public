import { useEffect, useRef, useState } from 'react'
import { useAdminPanelQuery } from './admin-panel-query'

// Automatic reads initialize the draft once; later edits require explicit reload.
export function useAdminDraftQuery<T>(name: string, url: string, apply: (data: T) => void, active = true) {
  const query = useAdminPanelQuery<T>(name, url, active)
  const initialized = useRef<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    if (query.data && initialized.current !== query.scopeKey) {
      initialized.current = query.scopeKey
      try { apply(query.data) } catch (cause) { setError(cause instanceof Error ? cause : new Error(String(cause))) }
    }
  }, [query.data, query.scopeKey, apply])
  const load = async () => {
    setError(null)
    try { apply(await query.load()); initialized.current = query.scopeKey }
    catch (cause) { setError(cause instanceof Error ? cause : new Error(String(cause))) }
  }
  return { ...query, error: error ?? query.error, load }
}
