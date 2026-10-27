import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { copy } from '../copy'
import { apiJson, getApiErrorMessage } from './api-client'
import { adminApiJson } from './admin-api-client'
import { usePrivateQueryScope } from './private-query-scope'
import type { FeedbackDetail } from './feedback-contracts'

export function useFeedbackThread(scope: 'user' | 'admin', id: string | null, active: boolean) {
  const owner = usePrivateQueryScope(scope, active)
  const scopeKey = JSON.stringify(owner.key)
  const requestScope = JSON.stringify([id, scope, owner.identity, scope === 'admin' ? owner.key[3] : null])
  const client = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const writeAbort = useRef<AbortController | null>(null)
  const pendingRequest = useRef<{ signature: string; key: string } | null>(null)
  const api = scope === 'admin' ? adminApiJson : apiJson
  const endpoint = `/api/${scope}/feedback`
  const query = useInfiniteQuery({
    queryKey: [...owner.key, 'feedback', 'thread', id], enabled: owner.enabled && Boolean(id),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ signal, pageParam }) => api<FeedbackDetail>(`${endpoint}?feedback_id=${id}${pageParam ? `&before_revision=${pageParam}` : ''}`, { signal }),
    getNextPageParam: (page) => page.next_before_revision ?? undefined,
  })
  const data = useMemo(() => {
    const pages = query.data?.pages
    if (!pages?.length) return null
    const entries = new Map<number, FeedbackDetail['entries'][number]>()
    for (const page of [...pages].reverse()) for (const entry of page.entries) entries.set(entry.revision, entry)
    return { ...pages[0], entries: [...entries.values()].sort((a, b) => a.revision - b.revision), next_before_revision: pages[pages.length - 1]!.next_before_revision }
  }, [query.data])
  const load = useCallback(async () => {
    if (!owner.enabled || !id) return
    setWriteError(null)
    await query.refetch({ cancelRefetch: false })
  }, [owner.enabled, id, query.refetch])
  useEffect(() => {
    setWriteError(null); setSaving(false)
    return () => writeAbort.current?.abort()
  }, [id, active, owner.identity, scope, scopeKey])
  useEffect(() => { pendingRequest.current = null }, [requestScope])

  async function save(fields: Record<string, unknown>): Promise<boolean> {
    if (!owner.enabled || !data || !id || saving || query.isFetching) return false
    const body = { feedback_id: id, expected_revision: data.feedback.revision, ...fields }
    const signature = JSON.stringify({ feedback_id: id, ...fields })
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, key: crypto.randomUUID() }
    const controller = new AbortController()
    writeAbort.current = controller
    setSaving(true); setWriteError(null)
    try {
      await api(endpoint, { method: 'PATCH', json: { ...body, request_key: pendingRequest.current.key }, signal: controller.signal })
      if (controller.signal.aborted) return false
      pendingRequest.current = null
      await client.invalidateQueries({ queryKey: [...owner.key, 'feedback'] })
      return !controller.signal.aborted
    } catch (caught) {
      if (!controller.signal.aborted) setWriteError(getApiErrorMessage(caught, copy.feedback.saveFailed))
      return false
    } finally { if (!controller.signal.aborted) setSaving(false) }
  }

  return { data, loading: query.isFetching, saving, error: writeError ?? (query.error ? getApiErrorMessage(query.error, copy.feedback.loadFailed) : null), refresh: load,
    loadOlder: async () => { if (owner.enabled && query.hasNextPage && !query.isFetching) await query.fetchNextPage({ cancelRefetch: false }) }, save }
}
