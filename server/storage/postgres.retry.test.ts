import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm'
import { retryPostgresQuery } from './postgres'

afterEach(() => vi.useRealTimers())

describe('PostgreSQL query retries', () => {
  it.each(['40P01', '40001'])('retries %s from pg and from Drizzle', async (code) => {
    vi.useFakeTimers()
    const cause = Object.assign(new Error('retryable query failure'), { code })
    const wrapped = new DrizzleQueryError('select 1', [], cause)
    const work = vi.fn().mockRejectedValueOnce(cause).mockRejectedValueOnce(wrapped).mockResolvedValue('result')
    const assertion = expect(retryPostgresQuery(work)).resolves.toBe('result')
    await vi.runAllTimersAsync()
    await assertion
    expect(work).toHaveBeenCalledTimes(3)
  })

  it('stops after three retries and preserves the PostgreSQL error', async () => {
    vi.useFakeTimers()
    const cause = Object.assign(new Error('deadlock'), { code: '40P01' })
    const error = new DrizzleQueryError('select 1', [], cause)
    const work = vi.fn().mockRejectedValue(error)
    const assertion = expect(retryPostgresQuery(work)).rejects.toBe(cause)
    await vi.runAllTimersAsync()
    await assertion
    expect(work).toHaveBeenCalledTimes(4)
  })

  it('does not retry a constraint violation wrapped by Drizzle', async () => {
    const cause = Object.assign(new Error('unique violation'), { code: '23505' })
    const error = new DrizzleQueryError('insert into example values ($1)', ['value'], cause)
    const work = vi.fn().mockRejectedValue(error)
    await expect(retryPostgresQuery(work)).rejects.toBe(cause)
    expect(work).toHaveBeenCalledOnce()
  })
})
