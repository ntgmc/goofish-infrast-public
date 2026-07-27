import { describe, expect, it } from 'vitest'
import { evaluateBehaviorRiskEvents, type BehaviorRiskEvent } from './scoring'

const now = new Date('2026-07-25T12:00:00.000Z')
const expiresAt = '2026-10-23T12:00:00.000Z'

function event(
  id: string,
  userId: string,
  eventType: BehaviorRiskEvent['event_type'],
  minute: number,
  patch: Partial<BehaviorRiskEvent> = {},
): BehaviorRiskEvent {
  return {
    id,
    event_type: eventType,
    user_id: userId,
    profile_id: null,
    job_id: null,
    browser_hmac: 'browser-a',
    session_hmac: null,
    network_hmac: 'network-a',
    ua_hmac: 'ua-a',
    uid_hmac: null,
    output_hash: null,
    page_category: null,
    structure_summary: null,
    occurred_at: new Date(now.getTime() - minute * 60_000).toISOString(),
    expires_at: expiresAt,
    ...patch,
  }
}

function rapidPath(userId: string, prefix: string, browser = 'browser-a'): BehaviorRiskEvent[] {
  return [
    event(`${prefix}:register`, userId, 'register', 29, { browser_hmac: browser }),
    event(`${prefix}:bind`, userId, 'bind', 25, { browser_hmac: browser }),
    event(`${prefix}:generate`, userId, 'generate', 20, { browser_hmac: browser }),
    event(`${prefix}:export`, userId, 'export', 10, { browser_hmac: browser, output_hash: `${prefix}-output` }),
  ]
}

describe('evaluateBehaviorRiskEvents', () => {
  it('keeps two accounts with two UIDs separate even when they share a browser', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { uid_hmac: 'uid-a' }),
      event('b', 'user-b', 'bind', 20, { uid_hmac: 'uid-b' }),
    ], now)

    expect(result).toHaveLength(2)
    expect(result.every((evaluation) => evaluation.score === 0)).toBe(true)
    expect(result.every((evaluation) => evaluation.createCase === false)).toBe(true)
  })

  it('does not score two accounts sharing only a network and user agent', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'register', 30, { browser_hmac: null }),
      event('b', 'user-b', 'register', 20, { browser_hmac: null }),
    ], now)

    expect(result).toHaveLength(2)
    expect(result.every((evaluation) => evaluation.rules.every((rule) => rule.category !== 'environment'))).toBe(true)
  })

  it('creates one high-confidence case for three accounts and three UIDs on one browser', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { uid_hmac: 'uid-a' }),
      event('b', 'user-b', 'bind', 20, { uid_hmac: 'uid-b' }),
      event('c', 'user-c', 'bind', 10, { uid_hmac: 'uid-c' }),
    ], now)[0]

    expect(result.userIds).toEqual(['user-a', 'user-b', 'user-c'])
    expect(result.score).toBe(55)
    expect(result.strongSignal).toBe(true)
    expect(result.createCase).toBe(true)
    expect(result.rules.map((rule) => rule.code)).toEqual(['browser_identity_cluster'])
  })

  it('scores but does not create a case for three accounts and UIDs sharing only network and user agent', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { browser_hmac: 'browser-a', uid_hmac: 'uid-a' }),
      event('b', 'user-b', 'bind', 20, { browser_hmac: 'browser-b', uid_hmac: 'uid-b' }),
      event('c', 'user-c', 'bind', 10, { browser_hmac: 'browser-c', uid_hmac: 'uid-c' }),
    ], now)[0]

    expect(result.score).toBe(35)
    expect(result.strongSignal).toBe(false)
    expect(result.createCase).toBe(false)
    expect(result.rules[0]).toMatchObject({ code: 'environment_multi_uid', category: 'environment' })
  })

  it('requires three new accounts before scoring an environment burst', () => {
    const twoAccounts = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'register', 30, { browser_hmac: null }),
      event('b', 'user-b', 'register', 20, { browser_hmac: null }),
    ], now)
    const threeAccounts = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'register', 30, { browser_hmac: null }),
      event('b', 'user-b', 'register', 20, { browser_hmac: null }),
      event('c', 'user-c', 'register', 10, { browser_hmac: null }),
    ], now)[0]

    expect(twoAccounts.every((evaluation) => evaluation.score === 0)).toBe(true)
    expect(threeAccounts.score).toBe(25)
    expect(threeAccounts.rules[0]?.code).toBe('environment_account_burst')
    expect(threeAccounts.createCase).toBe(false)
  })

  it('requires three UIDs before scoring one account as multi-identity', () => {
    const twoUids = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { uid_hmac: 'uid-a' }),
      event('b', 'user-a', 'bind', 20, { uid_hmac: 'uid-b' }),
    ], now)[0]
    const threeUids = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { uid_hmac: 'uid-a' }),
      event('b', 'user-a', 'bind', 20, { uid_hmac: 'uid-b' }),
      event('c', 'user-a', 'bind', 10, { uid_hmac: 'uid-c' }),
    ], now)[0]

    expect(twoUids.score).toBe(0)
    expect(threeUids.score).toBe(20)
    expect(threeUids.rules[0]?.code).toBe('account_multi_uid')
    expect(threeUids.createCase).toBe(false)
  })

  it('does not treat any volume of distinct exports as risk evidence', () => {
    const exports = Array.from({ length: 6 }, (_, index) => (
      event(`export-${index}`, 'user-a', 'export', index * 10, { output_hash: `output-${index}` })
    ))
    const result = evaluateBehaviorRiskEvents(exports, now)[0]

    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
    expect(result.rules).toEqual([])
    expect(result.strongSignal).toBe(false)
    expect(result.createCase).toBe(false)
  })

  it('does not restore an export-based strong signal when one account has three UIDs', () => {
    const result = evaluateBehaviorRiskEvents([
      event('bind-a', 'user-a', 'bind', 50, { uid_hmac: 'uid-a' }),
      event('bind-b', 'user-a', 'bind', 40, { uid_hmac: 'uid-b' }),
      event('bind-c', 'user-a', 'bind', 30, { uid_hmac: 'uid-c' }),
      event('export-a', 'user-a', 'export', 20, { output_hash: 'output-a' }),
      event('export-b', 'user-a', 'export', 10, { output_hash: 'output-b' }),
    ], now)[0]

    expect(result.score).toBe(20)
    expect(result.rules.map((rule) => rule.code)).toEqual(['account_multi_uid'])
    expect(result.strongSignal).toBe(false)
    expect(result.createCase).toBe(false)
  })

  it('keeps export as the terminal step of a low-weight rapid service path', () => {
    const result = evaluateBehaviorRiskEvents(rapidPath('user-a', 'a'), now)[0]

    expect(result.score).toBe(20)
    expect(result.rules[0]?.code).toBe('rapid_service_path')
    expect(result.createCase).toBe(false)
  })

  it('treats workspace adjustment as normal activity and suppresses rapid path', () => {
    const result = evaluateBehaviorRiskEvents([
      event('r', 'user-a', 'register', 29),
      event('b', 'user-a', 'bind', 25, { uid_hmac: 'uid-a' }),
      event('w', 'user-a', 'workspace_save', 23),
      event('g', 'user-a', 'generate', 20),
      event('e', 'user-a', 'export', 10, { output_hash: 'output-a' }),
    ], now)[0]

    expect(result.rules.some((rule) => rule.code === 'rapid_service_path')).toBe(false)
  })

  it('requires three matching accounts for cohort cadence and replaces their rapid-path score', () => {
    const twoAccounts = evaluateBehaviorRiskEvents([
      ...rapidPath('user-a', 'a'),
      ...rapidPath('user-b', 'b'),
    ], now)
    const threeAccounts = evaluateBehaviorRiskEvents([
      ...rapidPath('user-a', 'a'),
      ...rapidPath('user-b', 'b'),
      ...rapidPath('user-c', 'c'),
    ], now)[0]

    expect(twoAccounts).toHaveLength(2)
    expect(twoAccounts.every((evaluation) => evaluation.rules.every((rule) => rule.code !== 'cohort_cadence'))).toBe(true)
    expect(threeAccounts.score).toBe(60)
    expect(threeAccounts.rules.map((rule) => rule.code)).toEqual(['environment_account_burst', 'cohort_cadence'])
    expect(threeAccounts.createCase).toBe(true)
  })

  it('uses the strongest environment rule without adding weaker matches', () => {
    const result = evaluateBehaviorRiskEvents([
      event('register-a', 'user-a', 'register', 50, { uid_hmac: 'uid-a' }),
      event('register-b', 'user-b', 'register', 40, { uid_hmac: 'uid-b' }),
      event('register-c', 'user-c', 'register', 30, { uid_hmac: 'uid-c' }),
    ], now)[0]

    expect(result.score).toBe(55)
    expect(result.rules.map((rule) => rule.code)).toEqual(['browser_identity_cluster'])
  })

  it('requires two non-strong evidence families and at least 50 points to create a case', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a1', 'user-a', 'bind', 60, { browser_hmac: 'browser-a', uid_hmac: 'uid-a' }),
      event('a2', 'user-a', 'bind', 50, { browser_hmac: 'browser-a', uid_hmac: 'uid-b' }),
      event('a3', 'user-a', 'bind', 40, { browser_hmac: 'browser-a', uid_hmac: 'uid-c' }),
      event('b', 'user-b', 'bind', 30, { browser_hmac: 'browser-b', uid_hmac: 'uid-d' }),
      event('c', 'user-c', 'bind', 20, { browser_hmac: 'browser-c', uid_hmac: 'uid-e' }),
    ], now)[0]

    expect(result.score).toBe(55)
    expect(result.categories).toEqual(['environment', 'identity'])
    expect(result.strongSignal).toBe(false)
    expect(result.createCase).toBe(true)
  })

  it('scores one operator anomaly without creating a review case by itself', () => {
    const result = evaluateBehaviorRiskEvents([
      event('operator-1', 'user-a', 'operator_data_anomaly', 10, {
        structure_summary: {
          anomaly_type: 'operator_ownership_regression',
          operator_fingerprint_hash: 'a'.repeat(64),
          owned_count: 120,
        },
      }),
    ], now)[0]

    expect(result.score).toBe(20)
    expect(result.createCase).toBe(false)
  })

  it('scores repeated operator anomalies once as a 55-point strong signal', () => {
    const result = evaluateBehaviorRiskEvents([
      event('operator-1', 'user-a', 'operator_data_anomaly', 20, {
        structure_summary: {
          anomaly_type: 'operator_ownership_regression',
          operator_fingerprint_hash: 'a'.repeat(64),
          owned_count: 120,
        },
      }),
      event('operator-2', 'user-a', 'operator_data_anomaly', 10, {
        structure_summary: {
          anomaly_type: 'operator_count_regression',
          operator_fingerprint_hash: 'b'.repeat(64),
          owned_count: 112,
        },
      }),
      event('operator-3', 'user-a', 'operator_data_anomaly', 5, {
        structure_summary: {
          anomaly_type: 'operator_count_regression',
          operator_fingerprint_hash: 'b'.repeat(64),
          owned_count: 112,
        },
      }),
    ], now)[0]

    expect(result.score).toBe(55)
    expect(result.strongSignal).toBe(true)
    expect(result.rules.map((rule) => rule.code)).toEqual(['operator_data_anomaly_repeated'])
    expect(result.createCase).toBe(true)
  })
})
