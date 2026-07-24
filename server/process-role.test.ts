import { describe, expect, it } from 'vitest'
import {
  canMaintainOptimizeQueue,
  canRunOptimizeWorker,
  canServeApi,
  canStartCombinedProcess,
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

  it('allows the combined process outside production', () => {
    expect(canStartCombinedProcess({ NODE_ENV: 'development' })).toBe(true)
    expect(canStartCombinedProcess({ NODE_ENV: 'test', APP_ROLE: 'api' })).toBe(true)
  })

  it('requires the all role and explicit production combined opt-in', () => {
    expect(canStartCombinedProcess({
      NODE_ENV: 'production',
      APP_ROLE: 'all',
      ALLOW_PRODUCTION_COMBINED_PROCESS: 'true',
    })).toBe(true)

    for (const environment of [
      { NODE_ENV: 'production', APP_ROLE: 'all' },
      { NODE_ENV: 'production', APP_ROLE: 'all', ALLOW_PRODUCTION_COMBINED_PROCESS: '' },
      { NODE_ENV: 'production', APP_ROLE: 'all', ALLOW_PRODUCTION_COMBINED_PROCESS: '1' },
      { NODE_ENV: 'production', APP_ROLE: 'api', ALLOW_PRODUCTION_COMBINED_PROCESS: 'true' },
      { NODE_ENV: 'production', APP_ROLE: 'worker', ALLOW_PRODUCTION_COMBINED_PROCESS: 'true' },
    ]) {
      expect(canStartCombinedProcess(environment)).toBe(false)
    }
  })
})
