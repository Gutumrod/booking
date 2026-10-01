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

export type RefundableBookingStatus = 'cancelled' | 'expired' | 'no_show' | 'pending_review' | string;

export type RefundableDepositStatus =
  | 'not_required'
  | 'awaiting'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'refunded';

/** Deposit states that mean the shop is actually holding the customer's money. */
export const REFUND_HELD_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([
  'submitted',
  'verified',
  'rejected',
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
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the shop may mark this booking's deposit as refunded.
 *
 * Two shapes qualify, and both only *offer* the action — the decision stays with
 * the shop (A-20 forbids the system confirming or rejecting on the shop's behalf):
 *
 *  1. the queue is already released (cancelled / expired / no_show) and a deposit
 *     is being held — the ordinary "we owe this customer money" case;
 *  2. the booking is still `pending_review` on a money-holding deposit but the
 *     appointment day has passed — ก้อน 1's leftover list, where the shop still
 *     has to settle. Same-day is NOT overdue.
 *
 * Everything else is refused: nothing held, already refunded, or a queue that is
 * still live. A rule that answered `true` for everything would fail the refusal
 * cases in tests/bk01-refund-contract.test.ts.
 */
export function canRecordRefund(
  booking: RefundCandidate,
  now: string,
  timeZone = 'Asia/Bangkok',
): boolean {
  if (!REFUND_HELD_DEPOSIT_STATES.includes(booking.depositStatus)) return false;
  if (!ISO_DATE.test(booking.date)) return false;

  if (booking.status === 'cancelled' || booking.status === 'expired' || booking.status === 'no_show') {
    return true;
  }

  if (booking.status === 'pending_review') {
    return booking.date < shopToday(now, timeZone);
  }

  return false;
}

/**
 * The shop's own calendar day for a given instant. Uses `en-CA` so the formatted
 * parts are already `YYYY-MM-DD`, matching the `YYYY-MM-DD` the admin dashboard
 * renders for a booking date.
 */
export function shopToday(now: string, timeZone = 'Asia/Bangkok'): string {
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
