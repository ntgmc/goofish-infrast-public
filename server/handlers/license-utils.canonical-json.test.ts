import { describe, expect, it } from 'vitest'
import { canonicalJson as sharedCanonicalJson } from '../../src/lib/crypto'
import { buildOperatorFingerprint, canonicalJson } from './license-utils'

describe.each([
  ['shared', sharedCanonicalJson],
  ['server', canonicalJson],
] as const)('%s canonical JSON', (_, serialize) => {
  it('sorts nested object keys while preserving array order and escaped strings', () => {
    const value = { z: [{ b: false, a: null }, 2, 1], a: '甲\n"乙"' }
    expect(serialize(value)).toBe('{"a":"甲\\n\\"乙\\"","z":[{"a":null,"b":false},2,1]}')
    expect(serialize({ a: value.a, z: [{ a: null, b: false }, 2, 1] })).toBe(serialize(value))
  })
})

describe('operator fingerprint serialization', () => {
  it('preserves the stored hash regardless of input order', () => {
    const operators = [
      { id: 'char_b', name: '乙', own: false, elite: 0, rarity: 4 },
      { id: 'char_a', name: '甲', own: true, elite: 2, rarity: 5 },
    ]
    const fingerprint = buildOperatorFingerprint(operators)
    expect(fingerprint.hash).toBe('7f2c3c71285c26d7c5075691ed25d8bcee693992c1be541a34a3048f74ba35d2')
    expect(fingerprint.owned_count).toBe(1)
    expect(buildOperatorFingerprint([...operators].reverse())).toEqual(fingerprint)
  })
})
