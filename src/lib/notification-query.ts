import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { apiJson, getApiErrorMessage } from './api-client'
import { copy } from '../copy'
import { markInventoryStale } from './inventory-refresh'
import type { UserNotification, UserNotificationPage } from './types'

export function useNotificationQuery(userId: string) {
  const client = useQueryClient()
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const mutation = useRef<AbortController | null>(null)
  const inventoryRevision = useRef<string | null>(null)
  const key = ['user', userId, null, 'notifications']
  const query = useInfiniteQuery({ queryKey: key, enabled: Boolean(userId),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => apiJson<UserNotificationPage>(`/api/user/notifications?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal, fallbackMessage: copy.notifications.loadError }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 60_000, refetchOnWindowFocus: 'always',
  })
  const notifications = useMemo(() => {
    const byId = new Map<string, UserNotification>()
    for (const page of query.data?.pages ?? []) for (const item of page.notifications) if (!byId.has(item.id)) byId.set(item.id, item)
    return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
  }, [query.data])
  const first = query.data?.pages[0]
  const last = query.data?.pages[query.data.pages.length - 1]
  useEffect(() => {
    if (!first) return
    const next = first.notifications.filter((item) => item.action?.kind === 'inventory').map((item) => `${item.id}:${item.updated_at}`).sort().join('|')
    if (inventoryRevision.current !== null && inventoryRevision.current !== next) markInventoryStale()
    inventoryRevision.current = next
  }, [first])
  useEffect(() => () => mutation.current?.abort(), [userId])
  const refresh = useCallback(async () => {
    if (query.isFetchingNextPage) await client.cancelQueries({ queryKey: ['user', userId, null, 'notifications'], exact: true })
    await query.refetch({ cancelRefetch: false })
  }, [client, userId, query.isFetchingNextPage, query.refetch])
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
  const loadMore = useCallback(async () => {
    if (query.hasNextPage && !query.isFetching) await query.fetchNextPage({ cancelRefetch: false })
  }, [query.hasNextPage, query.isFetching, query.fetchNextPage])
  async function mark(displayed?: UserNotification) {
    mutation.current?.abort()
    const controller = new AbortController()
    const versions = new Map(notifications.map((item) => [item.id, item.updated_at]))
    mutation.current = controller
    setWriteError(null)
    if (displayed) setMarkingId(displayed.id)
    else setMarkingAll(true)
    try {
      await client.cancelQueries({ queryKey: key, exact: true })
      const result = await apiJson<{ unread_count: number }>('/api/user/notifications', { method: 'PATCH',
        json: displayed ? { notification_id: displayed.id, updated_at: displayed.updated_at } : { all: true },
        fallbackMessage: copy.notifications.updateError, signal: controller.signal })
      if (controller.signal.aborted) throw new DOMException('Superseded', 'AbortError')
      await client.cancelQueries({ queryKey: key, exact: true })
      if (controller.signal.aborted) return
      const readAt = new Date().toISOString()
      client.setQueriesData<InfiniteData<UserNotificationPage>>({ queryKey: key, exact: true }, (data) => data && ({ ...data,
        pages: data.pages.map((page) => ({ ...page, unread_count: result.unread_count, notifications: page.notifications.map((item) =>
          !item.read_at && (displayed ? item.id === displayed.id && item.updated_at === displayed.updated_at : versions.get(item.id) === item.updated_at) ? { ...item, read_at: readAt } : item) })),
      }))
    } catch (cause) {
      if (!controller.signal.aborted) setWriteError(getApiErrorMessage(cause, copy.notifications.updateError))
      if (displayed) throw cause
    } finally {
      if (mutation.current === controller) { setMarkingAll(false); setMarkingId(null); mutation.current = null }
    }
  }
  return { notifications, unreadCount: last?.unread_count ?? 0, nextCursor: last?.next_cursor ?? null,
    loading: query.isLoading, loadingMore: query.isFetchingNextPage, markingAll, markingId,
    error: writeError ?? (query.error ? getApiErrorMessage(query.error, copy.notifications.loadError) : null), refresh, loadMore,
    markRead: (item: UserNotification) => mark(item), markAllRead: () => mark() }
}
