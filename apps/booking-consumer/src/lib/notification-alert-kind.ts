/**
 * The fixed set of operator alerts this dispatch path may raise (BK01 P0 H2 —
 * council finding G21 plus review finding F3).
 *
 * WHY A FIXED ENUM. The round-1 review found (F2) that the alert dedupe was an
 * app-side function claiming a free-form message key, which let the same alert fire
 * on every dispatch run. The controller's ruling of 2026-10-01 replaced that:
 *  - the KIND must be a fixed word chosen in SQL-land, not a message the app invents;
 *  - the once-per-day limit belongs to SQL, so the app only has to say WHICH kind of
 *    event happened and let the ledger decide whether the Owner is told.
 * So every alert this route can raise is named here, as a constant, and
 * `pushAlertDedupeKey()` derives its key from it. An alert kind that is not in this
 * list cannot be raised.
 *
 * THREE KINDS, THREE DISTINCT FACTS. Each one says a guard is NOT running, which is
 * why they are reported at all:
 *
 *   - `cap_unverified`   — the monthly push count and/or cap was unreadable, so the
 *     cost guard did not engage (G21).
 *   - `quota_unreadable` — the shared OA's quota could not be read, so the 80%
 *     breaker did not engage (review finding F3: the report claimed to cover this
 *     and the code did not).
 *   - `breaker_open`     — the shared OA passed 80% and Free shops are paused. This
 *     one IS a measurement, so its day key is not retryable.
 *
 * WHAT IS PROVEN, AND WHAT IS NOT. The app side is complete: the dispatch route
 * reaches the ledger through the alert-mode call on the EXISTING claim RPC
 * (`claim_due_shop_email_notifications`, no new function name) and the operator
 * transport is a Resend adapter. What is NOT MEASURED is a real e-mail: there is no
 * live API key in this environment, so delivery to the Owner is proven with an
 * injected fake and reported as unmeasured. The claim/acknowledge split itself is
 * the SQL contract (two phases, a five-minute lease, one alert per key per Thai day).
 *
 * Pure and framework-free so `tests/` can pin it without a database.
 */

/** Every operator alert this dispatch path may raise. */
export const PUSH_ALERT_KINDS = ['cap_unverified', 'quota_unreadable', 'breaker_open'] as const;

export type PushAlertKind = (typeof PUSH_ALERT_KINDS)[number];

/**
 * Whether an alert of this kind was raised from a MEASUREMENT that succeeded.
 *
 * `breaker_open` is: the quota read returned a number over the threshold, so the
 * fact is known and a repeat attempt must not re-notify. The other two are raised
 * precisely because a read FAILED; if the alert itself never landed, the day may be
 * retried.
 */
export function alertKindIsMeasured(kind: PushAlertKind): boolean {
  return kind === 'breaker_open';
}

export function isPushAlertKind(value: unknown): value is PushAlertKind {
  return typeof value === 'string' && (PUSH_ALERT_KINDS as readonly string[]).includes(value);
}
