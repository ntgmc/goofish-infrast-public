import { describe, expect, it, vi } from 'vitest'

const { ensureDatabaseSchemaMock, queryMock } = vi.hoisted(() => ({
  ensureDatabaseSchemaMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock('./schema', () => ({
  ensureDatabaseSchema: ensureDatabaseSchemaMock,
}))

vi.mock('./postgres', () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}))

import { createPostgresOptimizeJobStore } from './optimize-job-store'

describe('optimization store schema initialization', () => {
  it('retries schema initialization after a transient failure', async () => {
    const store = createPostgresOptimizeJobStore()
    ensureDatabaseSchemaMock.mockRejectedValueOnce(new Error('transient schema validation error'))
    ensureDatabaseSchemaMock.mockResolvedValue(undefined)
    queryMock.mockResolvedValue({ rows: [] })

    await expect(store.getJob('job-1')).rejects.toThrow('transient schema validation error')
    await expect(store.getJob('job-1')).resolves.toBeNull()

    expect(ensureDatabaseSchemaMock).toHaveBeenCalledTimes(2)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
