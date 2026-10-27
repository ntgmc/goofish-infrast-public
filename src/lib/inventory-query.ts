import { useQuery } from '@tanstack/react-query'
import { apiJson } from './api-client'
import type { InventoryResponse } from './inventory-contracts'

export function useInventoryQuery(userId: string, profileId: string | null) {
  return useQuery({
    queryKey: ['user', userId, profileId, 'inventory'],
    queryFn: ({ signal }) => apiJson<InventoryResponse>('/api/user/inventory', { cache: 'no-store', signal }),
    enabled: Boolean(userId),
  })
}
