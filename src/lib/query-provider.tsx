import { useCallback, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useInventoryRefresh } from './inventory-refresh'

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  }))
  const refreshInventory = useCallback(async () => {
    await client.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'user'
        && (queryKey[3] === 'inventory' || queryKey[3] === 'onboarding-tasks'),
    }, { cancelRefetch: false })
  }, [client])
  useInventoryRefresh(refreshInventory)

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
