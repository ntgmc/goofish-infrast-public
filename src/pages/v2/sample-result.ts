import buildingSkills from '../../data/building-skills.json'
import { CONFIG_PRESETS, normalizeConfig } from '../../lib/config'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import sampleResult from './sample-result.json'

export const SAMPLE_RESULT = sampleResult as unknown as OptimizeResult

const operatorEntries: Array<[keyof typeof buildingSkills.operators, number, number]> = [
  ['char_4032_provs', 2, 4], ['char_112_siege', 2, 5], ['char_4065_judge', 2, 5],
  ['char_249_mlyss', 2, 5], ['char_1027_greyy2', 2, 4], ['char_4186_tmoris', 2, 4],
  ['char_4179_monstr', 2, 5], ['char_002_amiya', 2, 4], ['char_322_lmlee', 2, 5],
  ['char_4110_delphn', 2, 4], ['char_4194_rmixer', 2, 5], ['char_4036_forcer', 2, 4],
  ['char_154_morgan', 2, 4], ['char_4228_closur', 2, 5], ['char_427_vigil', 2, 5],
  ['char_300_phenxi', 2, 5], ['char_128_plosis', 2, 4], ['char_4048_doroth', 1, 5],
  ['char_108_silent', 2, 4], ['char_248_mgllan', 2, 5], ['char_242_otter', 0, 4],
  ['char_180_amgoat', 2, 5], ['char_253_greyy', 2, 3], ['char_4182_oblvns', 2, 5],
  ['char_4087_ines', 2, 5], ['char_290_vigna', 2, 3], ['char_193_frostl', 2, 3],
  ['char_163_hpsts', 2, 4], ['char_381_bubble', 2, 3], ['char_003_kalts', 2, 5],
  ['char_308_swire', 2, 4], ['char_1048_orchd2', 2, 5], ['char_010_chen', 2, 5],
  ['char_4063_quartz', 2, 3], ['char_214_kafka', 2, 4], ['char_400_weedy', 2, 5],
  ['char_385_finlpp', 2, 3], ['char_4208_wintim', 2, 3], ['char_243_waaifu', 2, 4],
  ['char_446_aroma', 2, 4], ['char_159_peacok', 2, 3], ['char_1051_headb2', 2, 5],
  ['char_118_yuki', 2, 3], ['char_190_clour', 2, 3], ['char_336_folivo', 2, 4],
  ['char_1031_slent2', 2, 5], ['char_4062_totter', 2, 3], ['char_486_takila', 2, 4],
  ['char_254_vodfox', 2, 4], ['char_141_nights', 2, 3], ['char_437_mizuki', 2, 5],
  ['char_4066_highmo', 2, 4], ['char_241_panda', 0, 4], ['char_4203_kichi', 0, 4],
  ['char_4015_spuria', 0, 4], ['char_145_prove', 0, 4],
]

export const SAMPLE_OPERATORS: LicenseOperator[] = operatorEntries.map(([id, elite, rarity]) => ({
  id, name: buildingSkills.operators[id].name, own: true, elite, rarity,
}))

export const SAMPLE_CONFIG = normalizeConfig({
  ...CONFIG_PRESETS['252-1'],
  facility_layout: SAMPLE_RESULT.facility_layout,
  shift_hours: SAMPLE_RESULT.shift_hours,
  drones: { enable: true, auto: true, auto_strategy: 'inventory_balance', order: 'pre', targets: ['Pure Gold', 'Pure Gold', 'Pure Gold'] },
})
