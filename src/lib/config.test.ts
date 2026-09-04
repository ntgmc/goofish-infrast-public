import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, getRightFull252Variant, isRightFull252Config, normalizeConfig, normalizeDormitoryRule, parseShiftHours, resolveConfigLayout, validateConfig } from './config'
import { licenseConfigSchema } from './workspace-validation'

describe('preset configs', () => {
  it('defines 333 pure LMD with three LMD trading stations and three Pure Gold factories', () => {
    const config = normalizeConfig(CONFIG_PRESETS['333-lmd'])

    expect(config).toMatchObject({
      layout: '3-3-3',
      desc: '333 纯钱流',
      trading_stations_count: 3,
      manufacturing_stations_count: 3,
      product_requirements: {
        trading_stations: { LMD: 3 },
        manufacturing_stations: { 'Pure Gold': 3 },
      },
    })
    expect(licenseConfigSchema.safeParse(config).success).toBe(true)
    expect(validateConfig(config)).toEqual({ ok: true })
  })
})

describe('layout normalization', () => {
  it('accepts both right-full 252 variants while rejecting full-blood 252', () => {
    for (const variant of ['252', '252-1'] as const) {
      const config = normalizeConfig(CONFIG_PRESETS[variant])
      expect(resolveConfigLayout(config)).toBe('2-5-2')
      expect(getRightFull252Variant(config)).toBe(variant)
      expect(isRightFull252Config(config)).toBe(true)
      expect(licenseConfigSchema.safeParse(config).success).toBe(true)
      expect(validateConfig(config)).toEqual({ ok: true })
    }

    expect(validateConfig({
      ...CONFIG_PRESETS['252-1'],
      manufacturing_station_levels: [3, 3, 3, 3, 3],
    })).toEqual({
      ok: false,
      message: '当前支持 3 发电站布局和右满252；其他 2 发电站布局尚未开放。',
    })

    expect(validateConfig({
      ...CONFIG_PRESETS['243'],
      trading_station_levels: [3, 2],
    })).toEqual({
      ok: false,
      message: '当前支持 3 发电站布局和右满252；其他 2 发电站布局尚未开放。',
    })
  })
})

describe('dormitory rule normalization', () => {
  it('uses fixed dormitories for new presets while preserving explicit autofill', () => {
    expect(Object.values(CONFIG_PRESETS).every((preset) => preset.dormitory_rule === 'fixed')).toBe(true)
    expect(normalizeDormitoryRule(undefined)).toBe('fixed')
    expect(normalizeDormitoryRule('自动填满')).toBe('maa_autofill')
  })

  it.each(['maa_pure_autofill', 'maa-pure-autofill', 'pure_autofill', '纯自动填满'])(
    'normalizes %s without disabling Fiammetta',
    (rule) => {
      const config = normalizeConfig({
        ...CONFIG_PRESETS['243'],
        dormitory_rule: rule,
        Fiammetta: { enable: true },
      })
      expect(config.dormitory_rule).toBe('maa_pure_autofill')
      expect(config.Fiammetta?.enable).toBe(true)
    },
  )
})

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

  it.each([
    { schedule_mode: 'variable' },
    { schedule_mode: 'maa', variable_shift_schedule: { enable: true } },
    { schedule_mode: 'maa', variable_shift_schedule: { enabled: true } },
  ])('disables Fiammetta for automatic variable shifts', (variableConfig) => {
    const config = normalizeConfig({
      ...CONFIG_PRESETS['243'],
      shift_hours: [8, 8, 8],
      ...variableConfig,
    })
    expect(config.Fiammetta?.enable).toBe(false)
  })
})
