import { describe, expect, it } from 'vitest'
import { normalizePointsAmount, normalizeStoredPoints } from './balance-contracts'

describe('points amount normalization', () => {
  it.each([
    ['0.01', '0.01'],
    ['12.3', '12.30'],
    ['1000000.00', '1000000.00'],
    ['1', '1.00'],
  ])('normalizes %s to %s without floating-point arithmetic', (input, expected) => {
    expect(normalizePointsAmount(input)).toBe(expected)
  })

  it.each([
    12.3,
    '',
    '0',
    '0.00',
    '-1.00',
    '1e3',
    '1.001',
    '1000000.01',
    '010.00',
    ' 12.30 ',
  ])('rejects invalid input %j', (input) => {
    expect(normalizePointsAmount(input)).toBeNull()
  })

  it('normalizes stored signed numeric values for API output', () => {
    expect(normalizeStoredPoints('12.3')).toBe('12.30')
    expect(normalizeStoredPoints('-2')).toBe('-2.00')
    expect(normalizeStoredPoints(null)).toBe('0.00')
  })
})
