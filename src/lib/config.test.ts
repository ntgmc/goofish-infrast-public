import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig, parseShiftHours, validateConfig } from './config'

describe('shift hour normalization', () => {
  it.each([
    [6, 6, 6, 6],
    [8, 8, 8],
    [12, 12, 12],
    [24, 24, 24],
    [12, 6, 6],
  ])('preserves supported MAA patterns', (...hours) => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: hours })
    expect(config.shift_hours).toEqual(hours)
    expect(validateConfig(config)).toEqual({ ok: true })
  })

  it('falls back to 8-8-8 for invalid input', () => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [7, 7, 7] })
    expect(config.shift_hours).toEqual([8, 8, 8])
    expect(normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8] }).shift_hours).toEqual([8, 8, 8])
    expect(normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [12, 12] }).shift_hours).toEqual([8, 8, 8])
    expect(validateConfig({ ...CONFIG_PRESETS['243'], shift_hours: [12, 12] })).toEqual({
      ok: false,
      message: 'MAA 排班表需要 3–6 班；非等长间隔需覆盖 24 小时，等长间隔支持每 8、12 或 24 小时换班。',
    })
  })

  it('canonicalizes equivalent patterns with the longest high-efficiency shift first', () => {
    expect(parseShiftHours([6, 12, 6])).toEqual([12, 6, 6])
    expect(normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [6, 6, 12] }).shift_hours).toEqual([12, 6, 6])
  })

  it.each([
    [[8, 8, 8], true],
    [[12, 12, 12], true],
    [[6, 6, 6, 6], false],
    [[24, 24, 24], false],
    [[12, 6, 6], false],
  ] as const)('sets Fiammetta availability for %j', (hours, enabled) => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [...hours] })
    expect(config.Fiammetta?.enable).toBe(enabled)
  })
})
