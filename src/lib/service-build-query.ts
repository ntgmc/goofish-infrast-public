import { queryOptions } from '@tanstack/react-query'
import type { AppBuildMeta } from './types'

export const serviceBuildQueryOptions = queryOptions({ queryKey: ['public', 'service-build'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/health', { signal, cache: 'no-store', headers: { Accept: 'application/json' } })
    const payload = await response.json() as { build_meta?: AppBuildMeta }
    if (!payload.build_meta) throw new Error('Service health response is missing build metadata.')
    return { meta: payload.build_meta, ok: response.ok }
  },
})
