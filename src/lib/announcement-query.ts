import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { copy } from '../copy'
import { apiJson } from './api-client'
import type { AnnouncementPageResponse, AnnouncementPublicResponse, UserAnnouncementRead } from './types'

export function usePublicAnnouncementsQuery(enabled = true) {
  return useQuery({ queryKey: ['public', 'announcements', 'all'], enabled,
    queryFn: async ({ signal }) => {
      const data = await apiJson<AnnouncementPublicResponse>('/api/announcement', { signal, fallbackMessage: copy.public.pages_AnnouncementsPage_001 })
      return { ...data, announcements: Array.isArray(data?.announcements) ? data.announcements : [], popups: Array.isArray(data?.popups) ? data.popups : [] }
    } })
}

export type UserAnnouncementsResponse = { announcements?: UserAnnouncementRead[]; unread_count?: number }

export function userAnnouncementsKey(userId: string | null) {
  return ['user', userId, null, 'announcements'] as const
}

export function useUserAnnouncementsQuery(userId: string | null) {
  return useQuery({
    queryKey: [...userAnnouncementsKey(userId), 'all'],
    enabled: Boolean(userId),
    queryFn: ({ signal }) => apiJson<UserAnnouncementsResponse>('/api/user/announcements', { signal, fallbackMessage: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_001 }),
  })
}

export function useAnnouncementPageQuery(userId: string | null, page: number, unreadOnly: boolean, announcementId: string) {
  const client = useQueryClient()
  const pageKey = useMemo(() => [...(userId ? userAnnouncementsKey(userId) : ['public', 'announcements']), 'page', page, unreadOnly], [userId, page, unreadOnly])
  const cached = client.getQueryData<AnnouncementPageResponse>(pageKey)
  const locate = Boolean(announcementId && !cached?.announcements.some((item) => item.announcement.id === announcementId))
  const queryKey = useMemo(() => locate ? [...pageKey, announcementId] : pageKey, [pageKey, announcementId, locate])
  const params = new URLSearchParams({ page: String(page) })
  if (unreadOnly) params.set('unread_only', '1')
  if (announcementId) params.set('announcement_id', announcementId)
  const apiUrl = `${userId ? '/api/user/announcements' : '/api/announcement'}?${params}`
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiJson<AnnouncementPageResponse>(apiUrl, { signal }),
  })
  useEffect(() => {
    if (query.data && (queryKey !== pageKey || query.data.page !== page)) {
      client.setQueryData([...pageKey.slice(0, -2), query.data.page, unreadOnly], query.data, { updatedAt: query.dataUpdatedAt })
    }
  }, [client, query.data, query.dataUpdatedAt, queryKey, pageKey, page, unreadOnly])
  return { ...query, queryKey, apiUrl }
}

export async function updateUserAnnouncementQueries(client: QueryClient, userId: string, data: UserAnnouncementsResponse, pageKey?: QueryKey) {
  const filter = { queryKey: userAnnouncementsKey(userId) }
  await client.cancelQueries(filter)
  await client.invalidateQueries({ ...filter, refetchType: 'none' })
  if (Array.isArray(data.announcements)) {
    client.setQueriesData({ queryKey: pageKey ?? [...filter.queryKey, 'all'], exact: true }, data)
  }
  await client.refetchQueries({ ...filter, type: 'active', predicate: (query) => query.state.isInvalidated })
}
