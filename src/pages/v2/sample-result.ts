import { copy } from '../../copy'
import { CONFIG_PRESETS, normalizeConfig } from '../../lib/config'
import type { LicenseOperator, OptimizeResult, ShiftRoom } from '../../lib/types'

const names = copy.v2.sampleOperators
const operatorEntries: Array<[keyof typeof names, string]> = [
  ['silverash', 'char_172_svrash'], ['degenbrecher', 'char_4116_blkkgt'],
  ['gnosis', 'char_206_gnosis'], ['proviso', 'char_4032_provs'],
  ['tequila', 'char_486_takila'], ['shamare', 'char_254_vodfox'],
  ['exusiai', 'char_103_angel'], ['texas', 'char_102_texas'],
  ['lappland', 'char_140_whitew'], ['arene', 'char_271_spikes'],
  ['steward', 'char_502_nblade'], ['midnight', 'char_283_midn'],
  ['dorothy', 'char_4048_doroth'], ['ptilopsis', 'char_128_plosis'],
  ['silence', 'char_108_silent'], ['vermeil', 'char_190_clour'],
  ['scene', 'char_336_folivo'], ['ceobe', 'char_2013_cerber'],
  ['gravel', 'char_237_gravel'], ['spot', 'char_284_spot'],
  ['haze', 'char_141_nights'], ['weedy', 'char_400_weedy'],
  ['passenger', 'char_472_pasngr'], ['eunectes', 'char_416_zumama'],
  ['frostleaf', 'char_193_frostl'], ['vigna', 'char_290_vigna'],
  ['shirayuki', 'char_118_yuki'], ['conviction', 'char_159_peacok'],
  ['castle', 'char_286_cast3'], ['wildmane', 'char_496_wildmn'],
  ['amiya', 'char_002_amiya'], ['kaltsit', 'char_003_kalts'],
  ['mlynar', 'char_4064_mlynar'], ['siege', 'char_112_siege'],
  ['chen', 'char_010_chen'], ['greyy', 'char_253_greyy'],
  ['liskarm', 'char_107_liskam'], ['ifrit', 'char_134_ifrit'],
  ['mostima', 'char_213_mostma'], ['indigo', 'char_469_indigo'],
  ['lumen', 'char_4042_lumen'], ['fiammetta', 'char_300_phenxi'],
]

export const SAMPLE_OPERATORS: LicenseOperator[] = operatorEntries.map(([key, id]) => ({
  id, name: names[key], own: true, elite: 2, rarity: 5,
}))

export const SAMPLE_CONFIG = normalizeConfig({
  ...CONFIG_PRESETS['243'],
  shift_hours: [8, 8, 8],
  Fiammetta: { enable: false },
})

function room(keys: Array<keyof typeof names>, efficiency: number, product?: string): ShiftRoom {
  return { operators: keys.map((key) => names[key]), level: 3, efficiency, product }
}

// These fixed example plans illustrate the interface; they are never presented as a computed personal result.
export const SAMPLE_RESULT: OptimizeResult = {
  author: copy.v2.brand,
  title: copy.v2.sampleHistory,
  description: copy.v2.sampleNotice,
  buildingType: 243,
  planTimes: '8h-8h-8h',
  schedule_mode: 'maa',
  shift_hours: [8, 8, 8],
  total_schedule_hours: 24,
  total_efficiency: 1536,
  raw_results: [],
  daily_production: {
    hours: 24,
    manufacturing: { 'Pure Gold': 112, 'Battle Record': 32.4 },
    trading: { LMD: 54720 },
    consumption: { 'Pure Gold': 109.44 },
    net: { 'Pure Gold': 2.56 },
  },
  plans: [
    {
      name: copy.v2.shift(1), shift_hours: 8,
      rooms: {
        trading: [room(['silverash', 'degenbrecher', 'gnosis'], 140, 'LMD'), room(['shamare', 'tequila', 'proviso'], 162, 'LMD')],
        manufacture: [
          room(['dorothy', 'ptilopsis', 'silence'], 125, 'Pure Gold'),
          room(['vermeil', 'scene', 'ceobe'], 110, 'Pure Gold'),
          room(['weedy', 'passenger', 'eunectes'], 145, 'Battle Record'),
          room(['frostleaf', 'vigna', 'shirayuki'], 95, 'Battle Record'),
        ],
        control: [room(['amiya', 'kaltsit', 'mlynar', 'siege', 'chen'], 0)],
        power: [room(['greyy'], 20), room(['liskarm'], 20), room(['ifrit'], 15)],
        dormitory: [{ level: 5, autofill: true, operators: [] }],
      },
      drones: { enable: true, room: 'trading', index: 2, order: 'pre', mode: 'auto' },
    },
    {
      name: copy.v2.shift(2), shift_hours: 8,
      rooms: {
        trading: [room(['exusiai', 'texas', 'lappland'], 100, 'LMD'), room(['arene', 'steward', 'midnight'], 90, 'LMD')],
        manufacture: [
          room(['gravel', 'spot', 'haze'], 95, 'Pure Gold'),
          room(['dorothy', 'ptilopsis', 'silence'], 125, 'Pure Gold'),
          room(['conviction', 'castle', 'wildmane'], 100, 'Battle Record'),
          room(['vermeil', 'scene', 'ceobe'], 110, 'Battle Record'),
        ],
        control: [room(['amiya', 'kaltsit', 'mlynar', 'siege', 'chen'], 0)],
        power: [room(['mostima'], 20), room(['indigo'], 15), room(['lumen'], 15)],
        dormitory: [{ level: 5, autofill: true, operators: [] }],
      },
      drones: { enable: true, room: 'trading', index: 1, order: 'pre', mode: 'auto' },
    },
    {
      name: copy.v2.shift(3), shift_hours: 8,
      rooms: {
        trading: [room(['silverash', 'degenbrecher', 'gnosis'], 140, 'LMD'), room(['shamare', 'tequila', 'proviso'], 162, 'LMD')],
        manufacture: [
          room(['weedy', 'passenger', 'eunectes'], 145, 'Pure Gold'),
          room(['gravel', 'spot', 'haze'], 95, 'Pure Gold'),
          room(['frostleaf', 'vigna', 'shirayuki'], 95, 'Battle Record'),
          room(['conviction', 'castle', 'wildmane'], 100, 'Battle Record'),
        ],
        control: [room(['amiya', 'kaltsit', 'mlynar', 'siege', 'chen'], 0)],
        power: [room(['greyy'], 20), room(['liskarm'], 20), room(['ifrit'], 15)],
        dormitory: [{ level: 5, autofill: true, operators: [] }],
      },
      drones: { enable: true, room: 'trading', index: 2, order: 'pre', mode: 'auto' },
    },
  ],
}
