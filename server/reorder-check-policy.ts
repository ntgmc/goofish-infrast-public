export const REORDER_CHECK_MONTHLY_LIMIT = 2

export function getShanghaiMonthKey(value: Date): string {
  const shanghai = new Date(value.getTime() + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}
