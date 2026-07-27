import { readFile } from 'node:fs/promises'

export const PUBLIC_EFFICIENCY_DATA_FALLBACK = Object.freeze({
  workplaces: Object.freeze({}),
  operator_groups: Object.freeze({}),
  combination_rules: Object.freeze({}),
  control_center_rules: Object.freeze([]),
  dormitory_mood_recovery_rules: Object.freeze([]),
})

const PUBLIC_FALLBACK_SOURCE = `${JSON.stringify(PUBLIC_EFFICIENCY_DATA_FALLBACK, null, 2)}\n`

export function isPublicEfficiencyDataFallback(source) {
  return source === PUBLIC_FALLBACK_SOURCE
}

export async function readEfficiencyDataSource(sourcePath) {
  try {
    return await readFile(sourcePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return PUBLIC_FALLBACK_SOURCE
  }
}
