/**
 * Whether a rejected customer may upload a new slip (BK01 brief 23, part B4).
 *
 * The controller's rule set is: re-upload is allowed only while the queue is
 * still free; attempts are capped by the existing `slip_submit_count`; and once
 * somebody else has taken the slot the customer is told to book again.
 *
 * "The queue is still free" is not invented here -- it is read to mean exactly
 * what `local_service.authorize_deposit_slip_upload` already demands before it
 * will issue an upload grant: the booking is a `hold`, its deposit is `awaiting`
 * or `rejected`, and `expires_at` is still in the future. If this resolver ever
 * allowed a re-upload the SQL would refuse, the customer would get a dead link,
 * and the two definitions would have drifted. `tests/deposit-resubmit.test.ts`
 * pins that they agree.
 *
 * Pure and framework-free for unit testing from `tests/`.
 */

/**
 * The retry ceiling already used by this system: `notification-policy.ts` stops
 * a notification after 5 attempts. The brief says "limit by the existing
 * `slip_submit_count`", so the cap is that existing number rather than a new one.
 */
export const MAX_SLIP_SUBMISSIONS = 5;

export interface ResubmitInput {
  status: string;
  depositStatus: string;
  /** ISO timestamp, or null when the booking carries no expiry. */
  expiresAt: string | null;
  slipSubmitCount: number | null | undefined;
  /** Current time; injected so the resolver is deterministic under test. */
  now: Date;
}

export type ResubmitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'queue_taken' | 'attempts_exhausted' | 'not_rejected' | 'link_expired' };

export function resolveDepositResubmit(input: ResubmitInput): ResubmitDecision {
  const attempts = Math.max(0, Math.trunc(Number(input.slipSubmitCount ?? 0)) || 0);

  if (input.depositStatus !== 'rejected') return { allowed: false, reason: 'not_rejected' };
  if (input.status !== 'hold') return { allowed: false, reason: 'queue_taken' };

  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now.getTime()) {
    // The hold window closed, so the slot is no longer held for this customer.
    return { allowed: false, reason: 'queue_taken' };
  }

  if (attempts >= MAX_SLIP_SUBMISSIONS) return { allowed: false, reason: 'attempts_exhausted' };
  return { allowed: true };
}

/**
 * Which customer-facing screen a rejected/expired booking should show. Kept next
 * to the decision so the wording and the rule cannot disagree.
 */
export type CustomerBookingScreen =
  | 'cancelled'
  | 'rejected_resubmit'
  | 'rejected_queue_taken'
  | 'rejected_attempts_exhausted'
  | 'awaiting_review'
  | 'confirmed'
  | 'other';

export function resolveCustomerBookingScreen(input: ResubmitInput): CustomerBookingScreen {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.depositStatus === 'rejected') {
    const decision = resolveDepositResubmit(input);
    if (decision.allowed) return 'rejected_resubmit';
    return decision.reason === 'attempts_exhausted' ? 'rejected_attempts_exhausted' : 'rejected_queue_taken';
  }
  if (input.status === 'pending_review') return 'awaiting_review';
  if (input.status === 'confirmed') return 'confirmed';
  return 'other';
}
