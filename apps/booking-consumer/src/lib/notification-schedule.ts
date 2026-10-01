/**
 * Merchant notification scheduling policy (BK01 brief 23, part B3(ข)).
 *
 * Owner decision (STATUS-HOUSE A-20): the shop is told about a new deposit slip
 * by an e-mail that is sent immediately plus a daily summary at 09:00 and 17:00
 * Asia/Bangkok. Between 22:00 and 08:00 nothing is sent -- anything that would
 * have gone out in that window waits for the 09:00 round.
 *
 * Pure and framework-free so `tests/` can pin it without a clock or a network.
 * Thailand has held UTC+7 with no daylight saving since 1941, so the offset is a
 * constant here; `tests/notification-schedule.test.ts` cross-checks this module
 * against `Intl` with `timeZone: 'Asia/Bangkok'` so the constant can never drift
 * away from the platform's own idea of Bangkok time.
 */

export const BANGKOK_OFFSET_MINUTES = 7 * 60;
export const MERCHANT_QUIET_START_HOUR = 22;
export const MERCHANT_QUIET_END_HOUR = 8;
export const MERCHANT_SUMMARY_HOURS: readonly number[] = [9, 17];

export interface BangkokParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

export function bangkokParts(date: Date): BangkokParts {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Bangkok wall-clock time as `YYYY-MM-DD HH:MM`, for idempotency keys and logs. */
export function bangkokStamp(date: Date): string {
  const p = bangkokParts(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function isMerchantQuietHour(date: Date): boolean {
  const { hour } = bangkokParts(date);
  return hour >= MERCHANT_QUIET_START_HOUR || hour < MERCHANT_QUIET_END_HOUR;
}

/**
 * The next instant whose Bangkok wall clock reads exactly `hour:00`.
 * Strictly in the future: an instant already at `hour:00` returns the next day's,
 * so a caller can never schedule something for a moment that has passed.
 */
export function nextBangkokHour(date: Date, hour: number): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Bangkok hour must be an integer 0-23');
  }
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MINUTES * 60 * 1000);
  const target = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    hour,
    0,
    0,
    0,
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const targetMs = target <= shifted.getTime() ? target + dayMs : target;
  return new Date(targetMs - BANGKOK_OFFSET_MINUTES * 60 * 1000);
}

export type MerchantSendKind = 'immediate' | 'daily_summary';

/**
 * When a merchant e-mail of this kind should leave the outbox.
 *
 * - `immediate` (a slip just arrived): now, or the 09:00 round when now falls in
 *   the quiet window.
 * - `daily_summary`: the round itself. The summary enqueue is what places the row
 *   at 09:00 or 17:00, so a summary row can only land inside the quiet window if
 *   the enqueue is wrong -- and the Owner rule still wins, so it moves to the
 *   09:00 round rather than being sent.
 *
 * An unrecognised kind throws instead of silently behaving like `immediate`.
 */
export function resolveMerchantSendTime(now: Date, kind: MerchantSendKind): Date {
  if (kind !== 'immediate' && kind !== 'daily_summary') {
    throw new Error(`Unknown merchant send kind: ${String(kind)}`);
  }
  if (!isMerchantQuietHour(now)) return now;
  return nextBangkokHour(now, MERCHANT_SUMMARY_HOURS[0]);
}

/**
 * Whether `instant` is one of the two summary rounds, and which one. Used to keep
 * the outbox honest about the round a summary row belongs to.
 */
export function resolveSummaryRound(instant: Date): { round: 'morning' | 'afternoon' | null } {
  const { hour, minute } = bangkokParts(instant);
  if (minute !== 0) return { round: null };
  if (hour === MERCHANT_SUMMARY_HOURS[0]) return { round: 'morning' };
  if (hour === MERCHANT_SUMMARY_HOURS[1]) return { round: 'afternoon' };
  return { round: null };
}

/**
 * The two summary instants that fall inside a UTC day window, as ISO strings, so
 * the enqueue side never has to re-derive Bangkok arithmetic.
 */
export function summaryInstantsForUtcDay(dayIso: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso);
  if (!match) throw new Error('Expected a YYYY-MM-DD UTC day');
  const [, year, month, day] = match;
  return MERCHANT_SUMMARY_HOURS.map((hour) => {
    // Bangkok hh:00 on the same calendar day is (hh - 7) UTC, wrapping back one day.
    const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), hour - 7, 0, 0, 0);
    return new Date(utcMs).toISOString();
  }).sort();
}
