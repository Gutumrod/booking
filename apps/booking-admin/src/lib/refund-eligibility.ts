/**
 * BK01 P0 / H5 (council finding G23, brief 28 §4) — recording a deposit refund is
 * a RECORD, not a transfer.
 *
 * The deposit travels customer → shop PromptPay directly; the platform holds no
 * money and never moves any. So the only honest capability is letting the shop
 * record that it refunded off-system, with the transfer reference as mandatory
 * textual evidence.
 *
 * ONE PREDICATE, MIRRORED FROM THE SQL — this module is not a second opinion.
 * `local_service.record_deposit_refund` in
 * `supabase/bk01-migrations/20261002120000_bk01_council_p0.sql` (FINAL revision
 * f5fedb88) refuses with exactly:
 *
 *   deposit_status NOT IN ('submitted','verified','rejected') -> 'No held deposit'
 *   NOT ( status IN ('cancelled','no_show','completed')
 *         OR (queue_released_at IS NOT NULL AND queue_released_at < now())
 *         OR (end_timestamptz IS NOT NULL AND end_timestamptz < now()) ) -> refuse
 *
 * The older e0800ee revision accepted only `submitted`/`verified`; it is
 * SUPERSEDED and must not be used. The accepted set, the queue-release disjunct,
 * the end-time disjunct and the 120-character reference bound are all read back
 * from the migration in `tests/house-p0-app-refund-h5.test.ts`.
 *
 * The UI copy must agree with that guard: a button that is offered and then
 * refused teaches the shop that the click worked while the row does not change.
 *
 * TWO PREDICATES, KEPT SEPARATE ON PURPOSE. "Money the shop is holding" and "the
 * deposit a refund may be recorded against" are NOT the same question, and using
 * one for the other is the defect this module exists to prevent:
 *
 *   - `holdsDepositMoney()` / `REFUND_HELD_DEPOSIT_STATES` — money the shop TOOK
 *     IN. `submitted`/`verified` ONLY. A `rejected` slip was never accepted, so it
 *     must never inflate a collected total or a "deposits held" figure.
 *   - `REFUNDABLE_DEPOSIT_STATES` — the deposits the DATABASE will let a refund be
 *     recorded against: `submitted`, `verified`, `rejected`. Mirrors the SQL
 *     exactly, including `rejected`, because a refused slip is still a booking row
 *     holding a deposit decision and the shop may still have to send money back.
 *
 * Using the money predicate inside `canRecordRefund` made the two contradict: the
 * database would accept a refund for a rejected slip while the dashboard could
 * never offer it. `canRecordRefund` therefore uses the REFUND rule set, and the
 * money set stays where it is needed for totals.
 *
 * This module is deliberately free of Supabase imports so the rule can be
 * exercised in a plain Node test (no database, no network).
 */

export type RefundableBookingStatus =
  | 'hold'
  | 'pending_review'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired'
  | string;

export type RefundableDepositStatus =
  | 'not_required'
  | 'awaiting'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'refunded';

/**
 * Deposit states in which the shop is actually holding the customer's money.
 *
 * `rejected` is deliberately NOT here (caretaker decision, brief 23 §5c-3): a
 * rejected slip means the deposit was never accepted, so the app must not claim
 * it as money the shop owes back. `refunded` is not here either — once recorded,
 * it is settled.
 */
export const REFUND_HELD_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([
  'submitted',
  'verified',
]);

/**
 * The deposits the DATABASE will let a refund be recorded against — the set
 * `record_deposit_refund` checks with `deposit_status NOT IN (...)`.
 *
 * MIRRORS THE SQL EXACTLY, including `rejected`: a refused slip was never
 * accepted as money (so it is NOT in `REFUND_HELD_DEPOSIT_STATES`) but it is
 * still a booking row holding a deposit decision, and the shop may still have to
 * send money back for it. Two different questions, two different sets — using
 * the money set here is the defect this module exists to prevent: the database
 * would accept a refund for a rejected slip while the dashboard never offered it.
 */
export const REFUNDABLE_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([
  'submitted',
  'verified',
  'rejected',
]);

/**
 * The single "is the shop holding this deposit right now?" predicate.
 * Shared by the dashboard's collected total so a deposit state can never be
 * counted as money in one place and not in the other. This is NOT the refund
 * gate — see `REFUNDABLE_DEPOSIT_STATES`.
 */
export function holdsDepositMoney(depositStatus: string): boolean {
  return (REFUND_HELD_DEPOSIT_STATES as ReadonlyArray<string>).includes(depositStatus);
}

/**
 * Whether the DATABASE would accept a refund for this deposit status, read from
 * `REFUNDABLE_DEPOSIT_STATES` so the app and the SQL cannot drift.
 */
export function canRecordRefundForDeposit(depositStatus: string): boolean {
  return (REFUNDABLE_DEPOSIT_STATES as ReadonlyArray<string>).includes(depositStatus);
}

/**
 * Booking statuses whose queue is settled by their own name, without consulting
 * the clock — exactly the first disjunct of the SQL predicate.
 *
 * `expired` and `rejected` are deliberately ABSENT (caretaker decision after
 * Codex review round 2, brief 23 §5c verdict item (1)):
 *  - `expired` is NOT a released-queue status in its own right. A hold that expired
 *    while its appointment is still ahead must stay closed; one whose appointment
 *    has already ended qualifies through the time rule, not through its name.
 *  - `rejected` is not a booking status at all — the `bookings` CHECK forbids it
 *    (`product_rules_v1.sql:43`). A refused slip lives on a `hold` row as
 *    `deposit_status='rejected'`.
 */
export const SETTLED_QUEUE_STATUSES: ReadonlyArray<string> = Object.freeze([
  'cancelled',
  'no_show',
  'completed',
]);

/** The RPC the CONTRACT pins — three named arguments, no new function name. */
export const DEPOSIT_REFUND_RPC = 'record_deposit_refund';
export const DEPOSIT_REFUND_HISTORY_RPC = 'get_deposit_refund_history';

/** The reference is mandatory textual transfer evidence, at most 120 characters. */
export const REFUND_REFERENCE_MAX_LENGTH = 120;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{2}):(\d{2})(?::\d{2})?$/;

/** A `HH:MM` value that is actually a time of day. */
function parseClock(value: string): { hour: number; minute: number } | null {
  const match = value.match(CLOCK);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Whether the shop may record this booking's deposit as refunded.
 *
 * Mirrors the SQL predicate above:
 *   deposit_status IN ('submitted','verified','rejected')
 *   AND ( status IN ('cancelled','no_show','completed')
 *         OR queue_released_at < now()
 *         OR end_timestamptz  < now() )
 *
 *  - the DEPOSIT must be one the database will refund:
 *    `submitted` / `verified` / `rejected` — a refused slip is still refundable
 *    (the shop may have to send money back) even though it was never money the
 *    shop took in, so this uses the REFUND rule set, NOT `holdsDepositMoney()`;
 *  - the queue must be settled: `cancelled` / `no_show` / `completed`, OR the
 *    appointment has ENDED — the time tests are NOT gated by booking status, so
 *    `confirmed`, `hold`, `pending_review` and `expired` all qualify once their
 *    end (or their queue release) is in the past;
 *  - `expired` with a future end stays closed (its name is not a queue release);
 *  - "the appointment is over" is **end-of-appointment < now**, never a
 *    calendar-date comparison.
 *
 * Fail-closed: an unparseable or missing end time means "not over", and an
 * unreadable `now` is likewise not "over".
 */
export function canRecordRefund(
  booking: RefundCandidate,
  now: string,
  timeZone = 'Asia/Bangkok',
): boolean {
  // The REFUND rule set (includes `rejected`), not the money set: the database
  // accepts a refund for a refused slip and the dashboard must agree.
  if (!canRecordRefundForDeposit(booking.depositStatus)) return false;
  if (SETTLED_QUEUE_STATUSES.includes(booking.status)) return true;

  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return false;

  if (queueWasReleased(booking.queueReleasedAt) && Date.parse(booking.queueReleasedAt as string) < nowMs) {
    return true;
  }

  const endsAt = appointmentEndsAt(booking, timeZone);
  if (endsAt === null) return false;
  return Date.parse(endsAt) < nowMs;
}

/** A queue release instant the server supplied and that can be understood. */
function queueWasReleased(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * The instant the appointment ends, as an ISO-8601 UTC string, or null when it
 * cannot be established. Prefers the server's `end_timestamptz`; otherwise derives
 * it from the shop-local date + start time + service duration.
 */
export function appointmentEndsAt(
  booking: Pick<RefundCandidate, 'date' | 'time' | 'durationMinutes' | 'endTime'>,
  timeZone = 'Asia/Bangkok',
): string | null {
  // A value the database supplied but that cannot be understood is a
  // contradiction: fail closed rather than silently computing something else.
  if (typeof booking.endTime === 'string' && booking.endTime.trim()) {
    const fromServer = Date.parse(booking.endTime);
    if (Number.isNaN(fromServer)) return null;
    return new Date(fromServer).toISOString();
  }

  // No server value (null / undefined / blank) — derive from the shop's own
  // timeline. Any unparseable input below also returns null (fail closed).
  if (!ISO_DATE.test(booking.date)) return null;
  if (typeof booking.time !== 'string') return null;
  const clock = parseClock(booking.time);
  if (!clock) return null;
  if (typeof booking.durationMinutes !== 'number' || !Number.isFinite(booking.durationMinutes)) return null;

  const [year, month, day] = booking.date.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  const endMinutes = clock.hour * 60 + clock.minute + booking.durationMinutes;
  return new Date(wallClockToUtc(year, month, day, endMinutes, timeZone)).toISOString();
}

/**
 * Convert a shop-local wall clock (date + minutes from midnight) to a UTC instant,
 * without a date library. Two passes because the offset itself depends on the
 * instant. Minutes may exceed 1440: an appointment ending after midnight rolls into
 * the next day correctly.
 */
function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, 0, minutesFromMidnight, 0, 0);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  const second = guess - zoneOffsetMs(new Date(first), timeZone);
  return second;
}

/** Milliseconds that `timeZone` is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** The four values the audit row carries, in the order the shop reads them. */
export type DepositRefundAuditEntry = {
  at: string;
  /** Display label for the acting shop user, or null when the row only carries an id. */
  by: string | null;
  reference: string;
  note: string;
};

export type RefundCandidate = {
  status: RefundableBookingStatus;
  depositStatus: RefundableDepositStatus;
  /** Appointment date as `YYYY-MM-DD` in the shop's own timezone (Asia/Bangkok). */
  date: string;
  /** Appointment start as `HH:MM` (or `HH:MM:SS`), optional. */
  time?: string;
  /** Service duration in minutes, the fallback source for the appointment end. */
  durationMinutes?: number | null;
  /**
   * Server-supplied appointment end, `bookings.end_timestamptz` (read-only, already
   * returned by the same shops/bookings select). When present it wins over the
   * derived value, so the rule matches the database's own timeline.
   */
  endTime?: string | null;
  /**
   * Server-supplied queue release, `bookings.queue_released_at` (read-only). The
   * SQL predicate honours it as a second way a queue is settled, so the UI must
   * too — otherwise a booking the shop may settle is never offered.
   */
  queueReleasedAt?: string | null;
};
