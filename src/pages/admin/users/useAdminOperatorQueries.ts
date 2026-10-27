import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminCapability, AdminProfileOperatorData } from '../contracts'

export function useAdminOperatorQueries(username: string | null, capabilities: AdminCapability[], userId: string | null, active: boolean) {
  const client = useQueryClient()
  const [requested, setRequested] = useState<{ userId: string | null; ids: string[] }>({ userId, ids: [] })
  const ids = requested.userId === userId ? requested.ids : []
  const enabled = active && Boolean(username && userId)
  const owner = JSON.stringify([username, capabilities, userId, enabled])
  const current = useRef(owner)
  current.current = owner
  const key = (profileId: string) => ['admin', enabled ? username : null, 'details', capabilities, 'operators', userId, profileId]
  const read = async (profileId: string, signal: AbortSignal) => {
    const data = await adminApiJson<{ operator_data?: AdminProfileOperatorData }>(`/api/admin/users?user_id=${encodeURIComponent(userId!)}&profile_id=${encodeURIComponent(profileId)}&include=operators`, { signal, fallbackMessage: '加载干员数据失败' })
    if (!data.operator_data) throw new Error('加载干员数据失败')
    return data.operator_data
  }
  const queries = useQueries({ queries: ids.map((id) => ({ queryKey: key(id), enabled, queryFn: ({ signal }: { signal: AbortSignal }) => read(id, signal) })) })
  const data = Object.fromEntries(queries.flatMap((query, index) => enabled && query.data ? [[ids[index], query.data]] : [])) as Record<string, AdminProfileOperatorData>
  const load = async (id: string) => {
    if (!enabled || current.current !== owner) return null
    setRequested((old) => ({ userId, ids: [...new Set([...(old.userId === userId ? old.ids : []), id])] }))
    try {
      const value = await client.fetchQuery({ queryKey: key(id), queryFn: ({ signal }) => read(id, signal) })
      return current.current === owner ? value : null
    } catch { return null }
  }
  const setData: Dispatch<SetStateAction<Record<string, AdminProfileOperatorData>>> = (update) => {
    if (current.current !== owner && (typeof update === 'function' || Object.keys(update).length > 0)) return
    const next = typeof update === 'function' ? update(data) : update
    for (const id of ids) if (!(id in next)) client.removeQueries({ queryKey: key(id), exact: true })
    setRequested({ userId, ids: Object.keys(next) })
  }
  return { data, load, setData, loadingId: ids.find((_, index) => queries[index].isFetching), error: queries.find((query) => query.error)?.error }
}
