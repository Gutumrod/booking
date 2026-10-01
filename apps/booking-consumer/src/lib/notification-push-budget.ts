/**
 * The per-shop monthly push budget (BK01 brief 25, unit 7 item 2).
 *
 * Owner decision (A-21): each shop may receive a bounded number of LINE pushes
 * per month — Free 50, Basic/trial 600, Pro 1,500 — and the number is retunable,
 * so it arrives as `monthly_push_cap` in the entitlement context and is never a
 * literal anywhere in the app. There is no plan mirror of it either: a mirrored
 * number would be a second source of truth for a value the operator can retune.
 * With no cap in the context the guard is UNVERIFIED, not closed — see below.
 * The window is the Thai calendar month: it resets on the 1st at 00:00 Asia/Bangkok,
 * the same month key `local_service.bk01_month_key` uses for the booking quota.
 *
 * Over the cap the message is NOT sent and the reason is recorded on the outbox
 * row. Over the cap is not an error the customer sees: a customer at the cap must
 * never be shown a failure, and the shop must be able to see why nothing went out.
 *
 * The reply that confirms a queue at binding time is FREE and does NOT count
 * against the cap (A-21 and LINE pricing both): `countsAgainstPushCap` is the one
 * place that decides which events are metered.
 *
 * WHERE THIS SITS ON THE FAIL-CLOSED LINE — this is a COST guard, not a right.
 * The two are treated differently on purpose, and the difference is the point:
 *
 *   - an ENTITLEMENT the pack does not include (`customer_slip_decision_push`
 *     false on Free) is a right: unknown or false means SUPPRESS, because sending
 *     something the pack did not pay for is the error being prevented;
 *   - the monthly CAP is a budget: a cap that cannot be MEASURED does not suppress.
 *     Suppressing on an unreadable counter would silently switch off a paid-for
 *     customer benefit, which is the worse failure. It is allowed and reported as
 *     `unverified`, so the operator can see the guard is not yet active rather than
 *     believing it is. The moment the count is readable the guard is live, because
 *     the cap itself is already known from the plan.
 *
 * (The shared-OA breaker in `notification-oa-breaker.ts` follows the same rule for
 * the same reason — see the note there.)
 *
 * Pure and framework-free so `tests/` can pin the boundaries without a database.
 */

/** LINE push events that consume the monthly allowance. Reply is not one of them. */
export const METERED_PUSH_EVENTS: readonly string[] = ['reminder_3h', 'reminder_24h', 'deposit_rejected', 'deposit_slip_decision'];

/**
 * LINE reply is free and is never metered, so the binding confirmation is
 * excluded by name rather than by omission — a future event that is not a reply
 * must be added to METERED_PUSH_EVENTS explicitly to be charged.
 */
export const UNMETERED_EVENTS: readonly string[] = ['booking_created', 'binding_confirmation', 'booking_cancelled', 'booking_rescheduled'];

export function countsAgainstPushCap(eventType: string): boolean {
  return METERED_PUSH_EVENTS.includes(eventType);
}

/** Bangkok month key `YYYY-MM-01`, matching `local_service.bk01_month_key`. */
export const BANGKOK_OFFSET_MINUTES = 7 * 60;

export function bangkokMonthKey(at: Date): string {
  const shifted = new Date(at.getTime() + BANGKOK_OFFSET_MINUTES * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-01`;
}

export type PushCapDecision =
  /** Sent, and the cap was checked against a real count. */
  | { allowed: true; unverified: false }
  /** Sent, but the count could not be read — the guard is not active yet. */
  | { allowed: true; unverified: true; reason: 'push_cap_unverified' }
  | { allowed: false; unverified: false; reason: 'push_cap_reached' };

/**
 * Whether one more metered push may leave for this shop this month.
 *
 * `cap` is `monthly_push_cap` from the entitlement context (unit-7 SQL); `used` is
 * the count of metered rows already delivered in the month. The boundary is
 * `used >= cap`: the Nth push is allowed and the (N+1)th is not, matching the
 * booking quota's own `used < limit` rule.
 *
 * `used === null` means the count could not be read. That is reported as
 * `unverified` and ALLOWED — see the fail-closed note at the top of this file. A
 * `cap` that is absent or nonsensical is treated the same way: the entitlement
 * context is the only authority for it, and a context that does not carry the
 * column yet is a guard that is not active, not a reason to mute a paid shop.
 */
export function resolvePushCapDecision(input: {
  cap: number | null | undefined;
  used: number | null | undefined;
}): PushCapDecision {
  const cap = input.cap;
  const used = input.used;
  const capKnown = Number.isFinite(cap) && Math.floor(cap as number) >= 0;
  const usedKnown = Number.isFinite(used) && Math.floor(used as number) >= 0;

  if (!capKnown || !usedKnown) {
    return { allowed: true, unverified: true, reason: 'push_cap_unverified' };
  }
  const safeCap = Math.floor(cap as number);
  const safeUsed = Math.max(0, Math.floor(used as number));
  return safeUsed < safeCap
    ? { allowed: true, unverified: false }
    : { allowed: false, unverified: false, reason: 'push_cap_reached' };
}
