export const REORDER_CHECK_MONTHLY_LIMIT = 2

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60_000

export function getShanghaiMonthKey(value: Date): string {
  const shanghai = new Date(value.getTime() + SHANGHAI_UTC_OFFSET_MS)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

export function getShanghaiNextMonthStart(value: Date): string {
  const shanghai = new Date(value.getTime() + SHANGHAI_UTC_OFFSET_MS)
  return new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth() + 1, 1) - SHANGHAI_UTC_OFFSET_MS).toISOString()
}
