/**
 * B8 — deposit refund is a RECORD, not a transfer.
 *
 * The deposit travels customer → shop PromptPay directly; the platform holds no
 * money and never moves any. So the only honest capability is letting the shop
 * record that it refunded off-system, with an audit trail.
 *
 * This module is deliberately free of Supabase imports so the eligibility rule
 * can be exercised in a plain Node test (no database, no network).
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
 * rejected slip means the deposit was never accepted, so it is not money the shop
 * owes back. `refunded` is not here either — once recorded, it is settled.
 */
export const REFUND_HELD_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([
  'submitted',
  'verified',
]);

/**
 * B8b — the single "is the shop holding this deposit right now?" predicate.
 * Shared by the refund eligibility rule and the dashboard's collected total so a
 * deposit state can never be counted as money in one place and not the other.
 */
export function holdsDepositMoney(depositStatus: string): boolean {
  return (REFUND_HELD_DEPOSIT_STATES as ReadonlyArray<string>).includes(depositStatus);
}

/**
 * Booking statuses that settle the deposit on their own, without consulting the
 * clock: the appointment is already over for a reason we trust.
 *
 * `expired` and `rejected` are deliberately ABSENT — caretaker decision after
 * Codex review round 2 (brief 23 §5c verdict item (1)):
 *  - `expired` is NOT a released-queue status in its own right. A hold that expired
 *    while its appointment is still ahead must stay closed; one whose appointment
 *    has already ended qualifies through the time rule, not through its name.
 *  - `rejected` is not a booking status at all — the `bookings` CHECK forbids it
 *    (`product_rules_v1.sql:43`). A refused slip lives on a `hold` row as
 *    `deposit_status='rejected'`, which the money rule already excludes.
 *
 * Keeping a status here that the contract does not have is exactly the drift Codex
 * flagged: an "expired" queue the shop cannot legally settle, and an unreachable
 * "rejected" branch. The single predicate is enforced in `canRecordRefund()` and
 * mirrored in the SQL spec (evidence/b8-spec-v2-addendum-for-group5.sql).
 */
export const SETTLED_QUEUE_STATUSES: ReadonlyArray<string> = Object.freeze([
  'cancelled',
  'no_show',
  'completed',
]);

/** The RPC names B8 proposes to the caretaker — both are NEW functions (ก้อน 1 owns none of them). */
export const DEPOSIT_REFUND_RPC = 'record_deposit_refund';
export const DEPOSIT_REFUND_HISTORY_RPC = 'get_deposit_refund_history';

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
};

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
 * Whether the shop may mark this booking's deposit as refunded.
 *
 * Caretaker decision (brief 23 §5c verdict item (1) after Codex review round 2) —
 * ONE predicate, in this exact shape, mirrored character-for-character by the SQL
 * spec:
 *
 *   deposit_status IN ('submitted','verified')
 *   AND ( status IN ('cancelled','no_show','completed') OR end_timestamptz < now() )
 *
 *  - money must be held: `submitted` / `verified` only;
 *  - the queue must be settled: `cancelled` / `no_show` / `completed`, OR the
 *    appointment has ENDED — the time test is NOT gated by booking status, so
 *    `confirmed`, `hold`, `pending_review` and `expired` all qualify once their end
 *    is in the past;
 *  - `expired` with a future end stays closed (its name is not a queue release);
 *  - `deposit_status='rejected'` (a refused slip on a `hold` row) never opens;
 *  - "appointment is over" is **end-of-appointment < now**, never a calendar-date
 *    comparison, and a `confirmed` booking in the future is never offered.
 *
 * Fail-closed: an unparseable or missing end time means "not over" and the action
 * stays hidden. An unreadable `now` is likewise not "over".
 */
export function canRecordRefund(
  booking: RefundCandidate,
  now: string,
  timeZone = 'Asia/Bangkok',
): boolean {
  if (!holdsDepositMoney(booking.depositStatus)) return false;
  if (SETTLED_QUEUE_STATUSES.includes(booking.status)) return true;

  const endsAt = appointmentEndsAt(booking, timeZone);
  if (endsAt === null) return false;
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return false;
  return Date.parse(endsAt) < nowMs;
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
