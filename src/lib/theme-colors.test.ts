import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
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
const foregrounds = ['--color-ink', '--color-ink-2', '--color-muted', '--color-positive', '--color-negative', '--color-caution']

describe('dark theme readability', () => {
  it.each(surfaces)('keeps text and status colors readable on %s', surface => {
    for (const foreground of foregrounds) {
      expect(
        contrast(hexToken(darkTokens, foreground), hexToken(darkTokens, surface)),
        `${foreground} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('distinguishes input boundaries from page and panel backgrounds', () => {
    for (const surface of surfaces.slice(0, 3)) {
      expect(
        contrast(hexToken(darkStyles, '--input'), hexToken(darkTokens, surface)),
        `input boundary on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses progressively lighter surfaces for nested content and interaction', () => {
    const levels = surfaces.map(surface => luminance(hexToken(darkTokens, surface)))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1])
    }
  })
})
