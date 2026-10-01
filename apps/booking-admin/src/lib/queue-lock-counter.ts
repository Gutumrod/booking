/**
 * The single call path to the queue-lock counter (BK01 brief 23, part B9 contract).
 *
 * The queue-lock unit (task HOUSE-BK01-QUEUE-LOCK) is adding
 * `local_service.bk01_pending_past_appointment_count(shop_id)` -- the number of
 * `pending_review AND queue_released_at IS NOT NULL` rows, i.e. bookings whose
 * appointment has passed while the shop still has not decided. That counter is
 * wanted in two places: the admin badge and the daily summary e-mail.
 *
 * Two rules make this safe to ship before the function exists:
 *
 *   1. ONE entry point. Badge and e-mail both come through here, so they can
 *      never disagree about the number, and when the function lands there is one
 *      place to point at it.
 *
 *   2. FAIL-SOFT, never fabricate. If the function is missing -- the normal state
 *      today -- the caller gets `available: false` plus a status string. It does
 *      NOT get `0`. "The shop has nothing waiting" and "the system cannot tell"
 *      are different facts, and the shop would act on the first one: a shop that
 *      reads 0 concludes there is nothing to decide and stops looking.
 *
 * `tests/queue-lock-counter.test.ts` pins both, including the fail-soft path
 * against the real "function does not exist" error shape.
 */

export const QUEUE_LOCK_COUNTER_RPC = 'bk01_pending_past_appointment_count';

export interface PendingPastAppointmentResult {
  /** True only when a real number came back from the database. */
  available: boolean;
  /** The count. `null` whenever `available` is false -- never a fabricated 0. */
  count: number | null;
  /** Why the number is unavailable, for the badge text and the e-mail body. */
  status: QueueLockCounterStatus;
}

export type QueueLockCounterStatus =
  | 'ok'
  /** The function is not deployed yet (queue-lock unit still in flight). */
  | 'not_deployed'
  /** The call was rejected: permissions, a bad shop id, a runtime error. */
  | 'call_failed';

interface QueryResultLike {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

/**
 * Distinguishes "the function is not there yet" from "the call failed".
 *
 * The distinction is deliberately narrow: only a missing-function signal counts
 * as `not_deployed`. Anything else is `call_failed`, because telling an operator
 * "not deployed yet" when the real problem is a revoked grant or a wrong shop id
 * would send them looking in the wrong place. PostgREST reports a missing routine
 * as PGRST202 with "Could not find the function ... in the schema cache";
 * PostgreSQL reports 42883 undefined_function. Both are matched, nothing looser.
 */
export function classifyQueueLockCounterError(error: { message?: string | null; code?: string | null } | null): QueueLockCounterStatus {
  if (!error) return 'ok';
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (code === 'PGRST202' || code === '42883') return 'not_deployed';
  if (/could not find the function|function .* does not exist|undefined_function/i.test(message)) return 'not_deployed';
  return 'call_failed';
}

function toCount(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const candidate = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>).count ?? (raw as Record<string, unknown>).bk01_pending_past_appointment_count
    : raw;
  const parsed = typeof candidate === 'string' ? Number(candidate) : candidate;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return null;
  // A row count is a whole number. A fractional one means the function did not
  // return what this contract says it returns, so it is reported as unavailable
  // rather than quietly truncated into a number that looks fine.
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * Reads the counter through the one RPC. `rpc` is injected so the admin client
 * and the consumer runtime can each pass their own, while the behaviour under
 * test stays identical.
 */
export async function fetchPendingPastAppointmentCount(
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResultLike>,
  shopId: string,
): Promise<PendingPastAppointmentResult> {
  if (!shopId) return { available: false, count: null, status: 'call_failed' };

  let result: QueryResultLike;
  try {
    result = await rpc(QUEUE_LOCK_COUNTER_RPC, { shop_id: shopId });
  } catch {
    return { available: false, count: null, status: 'call_failed' };
  }

  const status = classifyQueueLockCounterError(result.error);
  if (status !== 'ok') return { available: false, count: null, status };

  const count = toCount(result.data);
  // A response that parses to no usable number is unavailable, not zero: the
  // function exists but did not tell us anything we can render.
  if (count === null) return { available: false, count: null, status: 'call_failed' };
  return { available: true, count, status: 'ok' };
}
