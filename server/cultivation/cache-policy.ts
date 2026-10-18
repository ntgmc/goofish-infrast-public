export const CULTIVATION_DAY_MS = 86400000

// Public recommendations use the same Beijing calendar day in every process.
export function cultivationDayStart(now = Date.now()): number {
  return Math.floor((now + 8 * 3600000) / CULTIVATION_DAY_MS) * CULTIVATION_DAY_MS - 8 * 3600000
}
