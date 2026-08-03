import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return { query, release, connect }
})

vi.mock('pg', () => ({
  Client: class {},
  Pool: class {
    connect = mocks.connect
    on = vi.fn()
  },
}))

import { closePool, withTransaction } from './postgres'

beforeEach(async () => {
  await closePool()
  process.env.DATABASE_URL = 'postgresql://unit.test/database'
  mocks.query.mockReset()
  mocks.release.mockReset()
  mocks.connect.mockClear()
})

describe('PostgreSQL transaction replay policy', () => {
  it('does not replay arbitrary callbacks after a retriable database error', async () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    const work = vi.fn(async () => {
      throw deadlock
    })
    mocks.query.mockResolvedValue({ rows: [] })

    await expect(withTransaction(work)).rejects.toBe(deadlock)

    expect(work).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledOnce()
    expect(mocks.query).toHaveBeenNthCalledWith(1, 'begin')
    expect(mocks.query).toHaveBeenNthCalledWith(2, 'rollback')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
