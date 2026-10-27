import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminCapability } from '../contracts'

export function useAdminDetailQuery<T, Selection>(options: {
  username: string | null; capabilities: AdminCapability[]; active: boolean; name: string
  read: (selection: Selection, signal: AbortSignal) => Promise<T>
  identify: (data: T) => Selection
}) {
  const client = useQueryClient()
  const [selection, select] = useState<Selection | null>(null)
  const enabled = options.active && Boolean(options.username)
  const owner = JSON.stringify([options.username, options.capabilities, enabled])
  const current = useRef({ owner, selection: JSON.stringify(selection) })
  current.current = { owner, selection: JSON.stringify(selection) }
  const key = (target: Selection | null) => ['admin', enabled ? options.username : null, 'details', options.capabilities, options.name, target]
  const query = useQuery({ queryKey: key(selection), enabled: enabled && selection !== null,
    queryFn: ({ signal }) => options.read(selection!, signal) })
  const load = async (target: Selection): Promise<T | null> => {
    if (!enabled || current.current.owner !== owner || !client.getQueryState(key(selection))) return null
    select(target)
    const signature = JSON.stringify(target)
    current.current = { owner, selection: signature }
    try {
      const data = await client.fetchQuery({ queryKey: key(target), staleTime: 0, queryFn: ({ signal }) => options.read(target, signal) })
      return current.current.owner === owner && current.current.selection === signature ? data : null
    } catch { return null }
  }
  const setData: Dispatch<SetStateAction<T | null>> = (update) => {
    if (update === null) { current.current.selection = 'null'; select(null); return }
    if (!enabled || current.current.owner !== owner || current.current.selection !== JSON.stringify(selection) || !client.getQueryState(key(selection))) return
    const value = typeof update === 'function' ? (update as (data: T | null) => T | null)(query.data ?? null) : update
    if (value === null) { current.current.selection = 'null'; select(null); return }
    const target = options.identify(value)
    void client.cancelQueries({ queryKey: key(target), exact: true })
    client.setQueryData(key(target), value)
    select(target)
  }
  return { data: enabled && selection ? query.data ?? null : null, selection, setData, load,
    loading: query.isFetching, error: query.error }
}
