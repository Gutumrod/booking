/**
 * What a LINE push attempt actually told us (BK01 P0 H3 — council finding N01,
 * brief 28 §4).
 *
 * THE DEFECT. The dispatcher decided everything from `response.ok`:
 *
 *     delivered = response.ok;
 *     if (!response.ok) failureMessage = `LINE push failed with HTTP ${response.status}`;
 *
 * The request carries `X-Line-Retry-Key: <log id>`, which makes the send
 * idempotent at LINE's end. So when the provider accepted the first attempt but
 * the response never reached this Worker (a timeout, an eviction, a DB write that
 * failed after the push left), the retry re-sends under the SAME key — and LINE
 * answers 409 Conflict with `x-line-accepted-request-id`, meaning "I already have
 * this exact request, here is its id". Under `response.ok` that 409 was recorded
 * as a FAILED notification: the ledger said the customer was never messaged, the
 * push budget under-counted, and the shop's audit trail disagreed with LINE.
 *
 * THE THREE STATES ARE NOT TWO. The council finding and the controller both require
 * these to be kept apart:
 *
 *   1. PROVIDER ACCEPTED — LINE holds the message. Reached by a 2xx, or by a 409
 *      that NAMES the request it already accepted. A 409 without that id is not an
 *      acceptance: it is a conflict (bad retry key, an incompatible body under an
 *      already-used key) and must stay a failure.
 *   2. APPLICATION RECORDED — this outbox row was completed with that fact.
 *      Acceptance does not imply it: the process can die between the two, which is
 *      exactly why the retry key exists.
 *   3. RETRYABLE FAILURE — anything else: 5xx, 429, a network error, a rejected
 *      key. The row stays pending and is retried under the same key.
 *
 * `providerAccepted` is therefore the only thing this module reports; the caller
 * keeps `recorded` separate and only claims a delivery once the outbox write
 * returns. Nothing here claims exactly-once DELIVERY — what the retry key buys is
 * deduplicated ACCEPTANCE at the provider, which is what makes a 409 meaningful.
 *
 * SOURCE OF THE CONTRACT. The council's MASTER records the LINE behaviour as
 * checked against LINE's official "Retrying API requests" reference
 * (`COUNCIL-MASTER-ALL-ANSWERS-2026-10-01.md`, N01 + G19 evidence, and
 * `COUNCIL-REMEDIATION-RECOMMENDATIONS-2026-10-01.md` §5.6): a retry of an
 * already-accepted request returns 409 carrying `x-line-accepted-request-id`, and
 * the retry key is only valid for the original request. Header names below follow
 * that record; they are HTTP headers and are read case-insensitively because a
 * header is case-insensitive by specification.
 *
 * Pure and framework-free so `tests/` can pin it with a fake response.
 */

/** `x-line-accepted-request-id` — the header LINE returns on a duplicate accept. */
export const LINE_ACCEPTED_REQUEST_ID_HEADER = 'x-line-accepted-request-id';

/** The retry key header this Worker sends, so the send is idempotent at LINE. */
export const LINE_RETRY_KEY_HEADER = 'X-Line-Retry-Key';

/** HTTP 409 Conflict is the status LINE uses for an already-accepted retry. */
export const LINE_CONFLICT_STATUS = 409;

export type LinePushOutcome =
  /** LINE holds the message: a 2xx, or a 409 that named the accepted request. */
  | { providerAccepted: true; acceptedRequestId: string | null; status: number }
  /** The row stays pending and is retried under the same key. */
  | { providerAccepted: false; acceptedRequestId: null; status: number; reason: LineFailureReason };

export type LineFailureReason = 'line_rejected' | 'line_conflict_unconfirmed' | 'line_unreachable';

/** Anything with a case-insensitive `get`, which is what both `Headers` and a test fake offer. */
export interface ReadableHeaders {
  get(name: string): string | null | undefined;
}

/**
 * The accepted-request id LINE reports for an already-accepted retry, or `null`.
 *
 * An empty or whitespace-only value is treated as absent: a 409 that does not
 * actually name a request has not confirmed anything, and treating it as an
 * acceptance would be the same mistake in the other direction.
 */
export function readAcceptedRequestId(headers: ReadableHeaders | null | undefined): string | null {
  const raw = headers?.get(LINE_ACCEPTED_REQUEST_ID_HEADER);
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : null;
}

/**
 * Decide one push attempt from the provider's response.
 *
 * `ok` is the transport's own success flag; when the request never produced a
 * response the caller passes `ok: false, status: 0` and gets `line_unreachable`.
 */
export function resolveLinePushOutcome(input: {
  ok: boolean;
  status: number;
  headers?: ReadableHeaders | null;
}): LinePushOutcome {
  const acceptedRequestId = readAcceptedRequestId(input.headers);

  if (input.ok) {
    return { providerAccepted: true, acceptedRequestId, status: input.status };
  }

  // A 409 is an acceptance ONLY when it names the request it already holds. "Not
  // every 409 is a success" is the whole point of the finding.
  if (input.status === LINE_CONFLICT_STATUS && acceptedRequestId !== null) {
    return { providerAccepted: true, acceptedRequestId, status: input.status };
  }

  const reason: LineFailureReason = input.status === LINE_CONFLICT_STATUS
    ? 'line_conflict_unconfirmed'
    : input.status === 0
      ? 'line_unreachable'
      : 'line_rejected';

  return { providerAccepted: false, acceptedRequestId: null, status: input.status, reason };
}

/** The failure message recorded on the outbox row, or `null` when accepted. */
export function linePushFailureMessage(outcome: LinePushOutcome): string | null {
  if (outcome.providerAccepted) return null;
  if (outcome.reason === 'line_unreachable') return 'LINE dispatch is unavailable';
  if (outcome.reason === 'line_conflict_unconfirmed') {
    return `LINE push conflicted with HTTP ${outcome.status} without confirming an accepted request`;
  }
  return `LINE push failed with HTTP ${outcome.status}`;
}
