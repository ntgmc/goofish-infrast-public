import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return {
    query, release, connect,
    advisoryClients: [] as EventEmitter[],
    advisoryConnect: vi.fn(async () => undefined),
    advisoryQuery: vi.fn(),
    advisoryEnd: vi.fn(async () => undefined),
  }
})

vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Client: class extends EventEmitter {
      connect = mocks.advisoryConnect
      query = mocks.advisoryQuery
      end = mocks.advisoryEnd
      constructor() {
        super()
        mocks.advisoryClients.push(this)
      }
    },
    Pool: class {
      connect = mocks.connect
      on = vi.fn()
      end = vi.fn(async () => undefined)
    },
  }
})

import { closePool, withPostgresAdvisoryLock, withTransaction } from './postgres'

beforeEach(async () => {
  await closePool()
  process.env.DATABASE_URL = 'postgresql://unit.test/database'
  mocks.query.mockReset()
  mocks.release.mockReset()
  mocks.connect.mockClear()
  mocks.advisoryClients.length = 0
  mocks.advisoryConnect.mockClear()
  mocks.advisoryQuery.mockReset().mockResolvedValue({ rows: [{ acquired: true }] })
  mocks.advisoryEnd.mockClear()
})

describe('PostgreSQL advisory connection recovery', () => {
  it('returns the result and releases a healthy lock', async () => {
    await expect(withPostgresAdvisoryLock('maintenance', async () => 'done'))
      .resolves.toEqual({ acquired: true, value: 'done' })
    expect(mocks.advisoryQuery).toHaveBeenNthCalledWith(2,
      'select pg_advisory_unlock(hashtextextended($1, 0))', ['maintenance'])
    expect(mocks.advisoryEnd).toHaveBeenCalledOnce()
  })

  it('handles a dropped idle connection, fails the run and reconnects on the next run', async () => {
    const disconnected = new Error('Connection terminated unexpectedly')
    await expect(withPostgresAdvisoryLock('maintenance', async () => {
      expect(() => mocks.advisoryClients[0].emit('error', disconnected)).not.toThrow()
      return 'incomplete'
    })).rejects.toBe(disconnected)

    expect(mocks.advisoryQuery).toHaveBeenCalledOnce()
    expect(mocks.advisoryEnd).toHaveBeenCalledOnce()
    await expect(withPostgresAdvisoryLock('maintenance', async () => 'recovered'))
      .resolves.toEqual({ acquired: true, value: 'recovered' })
    expect(mocks.advisoryClients).toHaveLength(2)
    expect(mocks.advisoryEnd).toHaveBeenCalledTimes(2)
  })

  it('preserves the operation failure when the connection also drops', async () => {
    const failure = new Error('operation failed')
    await expect(withPostgresAdvisoryLock('maintenance', async () => {
      mocks.advisoryClients[0].emit('error', new Error('connection dropped'))
      throw failure
    })).rejects.toBe(failure)
    expect(mocks.advisoryEnd).toHaveBeenCalledOnce()
  })
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
    expect(mocks.release).toHaveBeenCalledWith(false)
  })

  it('discards the connection when rollback fails and preserves the operation error', async () => {
    const failure = new Error('operation failed')
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('rollback timeout'))
    const work = vi.fn(async () => { throw failure })

    await expect(withTransaction(work)).rejects.toBe(failure)

    expect(work).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(true)
  })
})
