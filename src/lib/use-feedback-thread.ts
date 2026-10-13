import { useCallback, useEffect, useRef, useState } from 'react'
import { copy } from '../copy'
import { apiJson, getApiErrorMessage } from './api-client'
import { adminApiJson } from './admin-api-client'
import type { FeedbackDetail } from './feedback-contracts'

export function useFeedbackThread(scope: 'user' | 'admin', id: string | null, active: boolean) {
  const [data, setData] = useState<FeedbackDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readAbort = useRef<AbortController | null>(null)
  const writeAbort = useRef<AbortController | null>(null)
  const pendingRequest = useRef<{ signature: string; key: string } | null>(null)
  const api = scope === 'admin' ? adminApiJson : apiJson
  const endpoint = `/api/${scope}/feedback`

  const load = useCallback(async (before?: number) => {
    if (!id || !active) return
    readAbort.current?.abort()
    const controller = new AbortController()
    readAbort.current = controller
    setLoading(true)
    setError(null)
    try {
      const result = await api<FeedbackDetail>(`${endpoint}?feedback_id=${id}${before ? `&before_revision=${before}` : ''}`, { signal: controller.signal })
      if (!controller.signal.aborted) setData((current) => before && current?.feedback.id === id
        ? { ...current, entries: [...result.entries, ...current.entries.filter((entry) => !result.entries.some((older) => older.revision === entry.revision))], next_before_revision: result.next_before_revision }
        : result)
    } catch (caught) {
      if (!controller.signal.aborted) setError(getApiErrorMessage(caught, copy.feedback.loadFailed))
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [active, api, endpoint, id])

  useEffect(() => {
    setData(null)
    setError(null)
    setLoading(false)
    setSaving(false)
    void load()
    return () => { readAbort.current?.abort(); writeAbort.current?.abort() }
  }, [load])

  useEffect(() => { pendingRequest.current = null }, [id])

  async function save(fields: Record<string, unknown>): Promise<boolean> {
    if (!data || !id || saving || loading) return false
    const body = { feedback_id: id, expected_revision: data.feedback.revision, ...fields }
    const signature = JSON.stringify({ feedback_id: id, ...fields })
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, key: crypto.randomUUID() }
    const controller = new AbortController()
    writeAbort.current = controller
    readAbort.current?.abort()
    setSaving(true)
    setError(null)
    try {
      await api(endpoint, { method: 'PATCH', json: { ...body, request_key: pendingRequest.current.key }, signal: controller.signal })
      if (controller.signal.aborted) return false
      pendingRequest.current = null
      await load()
      return !controller.signal.aborted
    } catch (caught) {
      if (!controller.signal.aborted) setError(getApiErrorMessage(caught, copy.feedback.saveFailed))
      return false
    } finally { if (!controller.signal.aborted) setSaving(false) }
  }

  return { data, loading, saving, error, refresh: () => load(), loadOlder: () => data?.next_before_revision ? load(data.next_before_revision) : Promise.resolve(), save }
}
