import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const lightTokens = tokens.slice(0, tokens.indexOf('.dark {'))
const darkTokens = tokens.slice(tokens.indexOf('.dark {'))
const darkStyles = styles.slice(styles.indexOf('.dark {'), styles.indexOf('\nhtml {'))

function hexToken(source: string, name: string) {
  const value = source.match(new RegExp(`${name}:\\s*(#[\\da-f]{6});`, 'i'))?.[1]
  if (!value) throw new Error(`Missing hex color token: ${name}`)
  return value
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

const surfaces = ['--color-paper', '--color-paper-2', '--color-paper-3', '--color-paper-4']
const foregrounds = ['--color-ink', '--color-ink-2', '--color-ink-3', '--color-positive', '--color-negative', '--color-caution']

describe.each([['light', lightTokens], ['dark', darkTokens]])('%s theme readability', (_theme, source) => {
  it.each(surfaces)('keeps text and status colors readable on %s', surface => {
    for (const foreground of foregrounds) {
      expect(
        contrast(hexToken(source, foreground), hexToken(source, surface)),
        `${foreground} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['--color-selected-ink', '--color-selected-bg'],
    ['--color-selected-ink', '--color-selected-hover'],
    ['--color-positive', '--color-positive-bg'],
    ['--color-negative', '--color-negative-bg'],
    ['--color-caution', '--color-caution-bg'],
    ['--color-overload', '--color-overload-bg'],
    ['--color-on-brand', '--color-brand-primary'],
    ['--color-on-brand', '--color-brand-hover'],
    ['--color-on-negative', '--color-negative'],
    ['--color-on-negative', '--color-negative-hover'],
  ])('keeps %s readable on %s', (foreground, background) => {
    expect(contrast(hexToken(source, foreground), hexToken(source, background))).toBeGreaterThanOrEqual(4.5)
  })

  it('distinguishes selection and input boundaries from their backgrounds', () => {
    expect(contrast(hexToken(source, '--color-selected-border'), hexToken(source, '--color-selected-bg'))).toBeGreaterThanOrEqual(3)
    for (const surface of surfaces.slice(0, 3)) {
      expect(contrast(hexToken(source, '--color-rule'), hexToken(source, surface))).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('dark input styles', () => {
  it('distinguishes input boundaries from page and panel backgrounds', () => {
    for (const surface of surfaces.slice(0, 3)) {
      expect(
        contrast(hexToken(darkStyles, '--input'), hexToken(darkTokens, surface)),
        `input boundary on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
