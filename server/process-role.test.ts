import { describe, expect, it } from 'vitest'
import {
  canMaintainOptimizeQueue,
  canRunOptimizeWorker,
  canServeApi,
  resolveAppRole,
  type AppRole,
} from './process-role'

describe('application process roles', () => {
  it.each([
    ['api', true, false, true],
    ['worker', false, true, true],
    ['all', true, true, true],
  ] as const)(
    'maps %s to its runtime capabilities',
    (role, servesApi, runsWorker, maintainsQueue) => {
      expect(canServeApi(role)).toBe(servesApi)
      expect(canRunOptimizeWorker(role)).toBe(runsWorker)
      expect(canMaintainOptimizeQueue(role)).toBe(maintainsQueue)
    },
  )

  it.each<AppRole>(['api', 'worker', 'all'])(
    'accepts the explicit %s role in production',
    (role) => {
      expect(resolveAppRole({ NODE_ENV: 'production', APP_ROLE: role })).toBe(role)
    },
  )

  it('normalizes surrounding whitespace and casing', () => {
    expect(resolveAppRole({ NODE_ENV: 'production', APP_ROLE: ' Worker ' })).toBe('worker')
  })

  it('defaults to all outside production', () => {
    expect(resolveAppRole({ NODE_ENV: 'development' })).toBe('all')
    expect(resolveAppRole({ NODE_ENV: 'test', APP_ROLE: '' })).toBe('all')
  })

  it('requires an explicit valid role in production', () => {
    expect(() => resolveAppRole({ NODE_ENV: 'production' })).toThrow('APP_ROLE is required in production')
    expect(() => resolveAppRole({ NODE_ENV: 'production', APP_ROLE: 'web' }))
      .toThrow('APP_ROLE must be one of: api, worker, all')
  })
})
