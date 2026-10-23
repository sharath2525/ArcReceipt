/**
 * utc-periods.ts — UTC interval arithmetic for daily/monthly reporting.
 *
 * All intervals are HALF-OPEN: [start, nextStart).
 *   An event at exactly midnight UTC belongs to the NEW day.
 *   An event at 23:59:59 UTC belongs to the OLD day.
 *
 * No external library. All arithmetic is in integer seconds.
 * All timestamps are Unix seconds (number), matching on-chain uint256 values
 * cast to Number (safe for dates through year ~2100 which fit in 53-bit float).
 *
 * Reporting timezone: UTC. Midnight UTC = 05:30 IST.
 *
 * BOUNDARY TEST VECTORS (deterministic):
 *
 * Day boundary (23:59:59 vs 00:00:00 UTC):
 *   dayStartUtc(1_800_000_000) should give 1_799_942_400 (2027-01-13 00:00:00 UTC)
 *   1_800_000_000 is inside that day (>= start, < start + 86400)
 *   1_800_000_000 - 1 = 1_799_999_999 → same day
 *   1_800_000_000 + 86399 → same day
 *   1_800_000_000 + 86400 = nextDayStart → new day
 *
 * Month boundary:
 *   monthStartUtc(Jan 31 2027 23:59:59) → 2027-01-01 00:00:00 UTC
 *   monthStartUtc(Feb 01 2027 00:00:00) → 2027-02-01 00:00:00 UTC
 *
 * Leap year: Feb 28 → Feb 29 2028 → Mar 1 2028 (2028 is a leap year).
 * Year rollover: Dec 31 23:59:59 UTC → Jan 1 00:00:00 UTC next year.
 *
 * Created-yesterday-paid-today:
 *   order.createdAt = 23:58 on day D → createdDay = D
 *   order.paidAt   = 00:03 on day D+1 → paidDay = D+1
 *   → createdCount[D]++, collectedAmount[D+1] += amount
 *   → NOT double-counted: counted once in collections (the paid day).
 */

/** Unix seconds at the start of the UTC day containing `ts`. */
export function dayStartUtc(ts: number): number {
  return ts - (ts % 86400)
}

/** Unix seconds at the start of the UTC day AFTER the one containing `ts`. */
export function nextDayStartUtc(ts: number): number {
  return dayStartUtc(ts) + 86400
}

/** Unix seconds at the start of the UTC month containing `ts`. */
export function monthStartUtc(ts: number): number {
  // Use Date to compute the 1st of the month in UTC, then convert back.
  const d = new Date(ts * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

/** Unix seconds at the start of the UTC month AFTER the one containing `ts`. */
export function nextMonthStartUtc(ts: number): number {
  const d = new Date(ts * 1000)
  // Setting day=1 and incrementing month wraps year correctly.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
}

/** True if `ts` falls inside the UTC day described by `dayStart`. */
export function isInUtcDay(ts: number, dayStart: number): boolean {
  return ts >= dayStart && ts < dayStart + 86400
}

/** True if `ts` falls inside the UTC month described by `monthStart`. */
export function isInUtcMonth(ts: number, monthStart: number): boolean {
  return ts >= monthStart && ts < nextMonthStartUtc(monthStart)
}

/** Format a UTC day start as a human-readable label, e.g. "Mon 13 Jan 2027". */
export function formatUtcDay(dayStart: number): string {
  return new Date(dayStart * 1000).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Format a UTC month start as a human-readable label, e.g. "January 2027". */
export function formatUtcMonth(monthStart: number): string {
  return new Date(monthStart * 1000).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Unix seconds at the start of the UTC month BEFORE the one containing `ts`.
 * Correct for all months including January (wraps to December of prior year).
 *
 * D11 FIX: replaces the old `monthStartUtc(now - 86400 * 32)` approach which
 * produces August when called on October 1 (32 days before Oct 1 = Aug 30).
 * The correct formula: start of the month that precedes the current month.
 *
 * Examples:
 *   ts = Oct 23 2026 → returns 2026-09-01 00:00:00 UTC  (September 2026)
 *   ts = Jan  5 2027 → returns 2026-12-01 00:00:00 UTC  (December 2026)
 *   ts = Mar  1 2028 → returns 2028-02-01 00:00:00 UTC  (February 2028, leap year)
 */
export function previousMonthStart(ts: number): number {
  const thisMonth = monthStartUtc(ts)
  // Go one second before this month's start → lands in the previous month
  return monthStartUtc(thisMonth - 1)
}

/** Current Unix timestamp as a number (seconds). */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000)
}

/** Start of the current UTC day. */
export function todayUtcStart(): number {
  return dayStartUtc(nowSecs())
}

/** Start of the current UTC month. */
export function thisMonthUtcStart(): number {
  return monthStartUtc(nowSecs())
}

/**
 * Build an array of UTC day-start timestamps for every day in the UTC month
 * described by `monthStart`. Handles varying month lengths and leap years.
 */
export function daysInUtcMonth(monthStart: number): number[] {
  const days: number[] = []
  let cur = monthStart
  const nextMonth = nextMonthStartUtc(monthStart)
  while (cur < nextMonth) {
    days.push(cur)
    cur += 86400
  }
  return days
}

/** Sum an array of bigints. */
export function sumBigInt(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n)
}
