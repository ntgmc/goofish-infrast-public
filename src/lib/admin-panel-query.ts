import { useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { copy } from '../copy'
import { adminApiJson } from './admin-api-client'
import { usePrivateQueryScope } from './private-query-scope'

export function useAdminPanelQuery<T>(name: string, url: string, active = true, options: { refetchInterval?: number; staleTime?: number; refetchOnWindowFocus?: 'always'; parse?: (data: unknown) => T } = {}) {
  const owner = usePrivateQueryScope('admin', active)
  const client = useQueryClient()
  const key = [...owner.key, name, url]
  const signature = JSON.stringify(key)
  const current = useRef(signature)
  current.current = signature
  const { parse, ...queryOptions } = options
  const query = useQuery({ queryKey: key, enabled: owner.enabled,
    queryFn: async ({ signal }) => {
      const data = await adminApiJson<T>(url, { signal })
      return parse ? parse(data) : data
    }, ...queryOptions })
  const load = useCallback(async () => {
    if (!owner.enabled || current.current !== signature) throw new Error(copy.admin.operations_failure_labels.auth_required)
    const result = await query.refetch({ cancelRefetch: false, throwOnError: true })
    return result.data!
  }, [owner.enabled, signature, query.refetch])
  const write = async (data: T) => {
    await client.cancelQueries({ queryKey: key, exact: true })
    client.setQueriesData({ queryKey: key, exact: true }, data)
  }
  return { ...query, data: owner.enabled ? query.data : undefined, load, write,
    scopeKey: JSON.stringify([owner.identity, owner.key[3], name, url]),
    refetch: (options?: Parameters<typeof query.refetch>[0]) => owner.enabled && current.current === signature ? query.refetch(options) : Promise.resolve(query) }
}
