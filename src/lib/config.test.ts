import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig, validateConfig } from './config'

describe('shift hour normalization', () => {
  it.each([
    [6, 6, 6, 6],
    [8, 8, 8],
    [12, 12],
    [12, 6, 6],
  ])('preserves valid 24-hour patterns', (...hours) => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: hours })
    expect(config.shift_hours).toEqual(hours)
    expect(validateConfig(config)).toEqual({ ok: true })
  })

  it('falls back to 8-8-8 for invalid input', () => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [7, 7, 7] })
    expect(config.shift_hours).toEqual([8, 8, 8])
    expect(normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8] }).shift_hours).toEqual([8, 8, 8])
  })
})
