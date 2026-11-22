import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const aliases = tokens.slice(tokens.indexOf(':root,', tokens.indexOf('.dark {')))
const lightTokens = tokens.slice(0, tokens.indexOf('.dark {')) + aliases
const darkTokens = tokens.slice(0, tokens.indexOf('.dark {')) + tokens.slice(tokens.indexOf('.dark {'))
const darkStyles = styles.slice(styles.indexOf('.dark {'), styles.indexOf('\nhtml {'))

function colorToken(source: string, name: string): string {
  const value = [...source.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].pop()?.[1].trim()
  if (!value) throw new Error(`Missing color token: ${name}`)
  const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  return alias ? colorToken(source, alias) : value
}

function luminance(color: string) {
  let channels: number[]
  if (color.startsWith('#')) {
    channels = [1, 3, 5].map(offset => {
      const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
  } else {
    const [lightness, chroma, hue] = color.match(/[\d.]+/g)!.map(Number)
    const a = chroma * Math.cos(hue * Math.PI / 180), b = chroma * Math.sin(hue * Math.PI / 180)
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    // OKLab to linear sRGB, clamped to the browser's display gamut.
    channels = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(value => Math.max(0, Math.min(1, value)))
  }
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
        contrast(colorToken(source, foreground), colorToken(source, surface)),
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
    expect(contrast(colorToken(source, foreground), colorToken(source, background))).toBeGreaterThanOrEqual(4.5)
  })

  it('distinguishes selection and input boundaries from their backgrounds', () => {
    expect(contrast(colorToken(source, '--color-selected-border'), colorToken(source, '--color-selected-bg'))).toBeGreaterThanOrEqual(3)
    for (const surface of surfaces.slice(0, 3)) {
      expect(contrast(colorToken(source, '--color-rule'), colorToken(source, surface))).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('dark input styles', () => {
  it('distinguishes input boundaries from page and panel backgrounds', () => {
    for (const surface of surfaces.slice(0, 3)) {
      expect(
        contrast(colorToken(darkTokens + darkStyles, '--input'), colorToken(darkTokens, surface)),
        `input boundary on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
