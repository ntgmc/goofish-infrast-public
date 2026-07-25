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

describe('evaluateBehaviorRiskEvents', () => {
  it('does not create a case from one IP-like environment signal alone', () => {
    const result = evaluateBehaviorRiskEvents([
      event('r1', 'user-a', 'register', 30, { browser_hmac: null }),
      event('r2', 'user-b', 'register', 20, { browser_hmac: null }),
    ], now)
    expect(result).toHaveLength(1)
    expect(result[0].score).toBe(35)
    expect(result[0].createCase).toBe(false)
  })

  it('creates a case when environment burst and rapid path are both present', () => {
    const events = [
      event('r1', 'user-a', 'register', 29),
      event('b1', 'user-a', 'bind', 25, { uid_hmac: 'uid-a' }),
      event('g1', 'user-a', 'generate', 20),
      event('e1', 'user-a', 'export', 10, { output_hash: 'output-a' }),
      event('r2', 'user-b', 'register', 28),
    ]
    const result = evaluateBehaviorRiskEvents(events, now)[0]
    expect(result.score).toBeGreaterThanOrEqual(50)
    expect(result.categories).toEqual(expect.arrayContaining(['environment', 'service_path']))
    expect(result.createCase).toBe(true)
  })

  it('permits the explicit strong browser composite as a single-category case', () => {
    const result = evaluateBehaviorRiskEvents([
      event('a', 'user-a', 'bind', 30, { uid_hmac: 'uid-a' }),
      event('b', 'user-b', 'bind', 20, { uid_hmac: 'uid-b' }),
    ], now)[0]
    expect(result.strongSignal).toBe(true)
    expect(result.rules.some((rule) => rule.code === 'strong_composite')).toBe(true)
    expect(result.createCase).toBe(true)
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

  it('creates a manual review case for repeated anomalies with different fingerprints', () => {
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
    expect(result.score).toBe(70)
    expect(result.strongSignal).toBe(true)
    expect(result.rules.some((rule) => rule.evidence.kind === 'operator_anomaly_fingerprints')).toBe(true)
    expect(result.createCase).toBe(true)
  })
})
