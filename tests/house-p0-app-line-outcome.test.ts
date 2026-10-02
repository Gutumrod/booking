/**
 * BK01 P0 — application unit H3 (council finding N01).
 *
 * WHAT FAILED. The dispatcher set `delivered = response.ok`. The push carries
 * `X-Line-Retry-Key: <outbox row id>`, so LINE deduplicates it: if the first
 * attempt was ACCEPTED but this Worker never saw the response (a timeout, an
 * eviction, a completion write that failed), the retry re-sends the same request
 * and LINE answers 409 Conflict with `x-line-accepted-request-id`. Under
 * `response.ok` that 409 was written down as a FAILED notification — the ledger,
 * the monthly push count and the shop's audit trail all disagreed with LINE.
 *
 * WHAT IS PROVEN HERE. The three states the council asked to be separated —
 * provider accepted, application recorded, retryable failure — are exercised
 * through the REAL route handler with a fake LINE transport that returns the exact
 * statuses and headers. The assertions are on the body that left, the status the
 * route wrote back through `complete_line_notification`, and the retry timing it
 * asked for. Nothing here counts rows.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LINE_ACCEPTED_REQUEST_ID_HEADER,
  LINE_CONFLICT_STATUS,
  LINE_RETRY_KEY_HEADER,
  linePushFailureMessage,
  readAcceptedRequestId,
  resolveLinePushOutcome,
} from '../apps/booking-consumer/src/lib/notification-line-outcome.ts';

// The handler lives in a library module now (the route module may export only HTTP
// methods), so the real dispatcher is imported from the module that implements it.
const dispatchRoute = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');

const read = (path: string) => readFileSync(path, 'utf8');

// ---------------------------------------------------------------------------
// A. The decision table
// ---------------------------------------------------------------------------

const headersOf = (values: Record<string, string>) => ({
  get: (name: string) => {
    const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? null : values[key];
  },
});

test('a 2xx is an acceptance', () => {
  const outcome = resolveLinePushOutcome({ ok: true, status: 200, headers: headersOf({}) });
  assert.equal(outcome.providerAccepted, true);
  assert.equal(linePushFailureMessage(outcome), null);
});

test('a 409 that names the accepted request IS an acceptance', () => {
  // The exact provider behaviour N01 is about: the request LINE already holds.
  const outcome = resolveLinePushOutcome({
    ok: false,
    status: LINE_CONFLICT_STATUS,
    headers: headersOf({ [LINE_ACCEPTED_REQUEST_ID_HEADER]: 'accepted-request-42' }),
  });
  assert.equal(outcome.providerAccepted, true);
  assert.equal(outcome.acceptedRequestId, 'accepted-request-42');
  assert.equal(linePushFailureMessage(outcome), null, 'an accepted retry is not a failure');
});

test('a 409 WITHOUT an accepted request id stays a failure — not every 409 is a success', () => {
  const outcome = resolveLinePushOutcome({ ok: false, status: LINE_CONFLICT_STATUS, headers: headersOf({}) });
  assert.equal(outcome.providerAccepted, false);
  assert.equal(outcome.reason, 'line_conflict_unconfirmed');
  assert.match(String(linePushFailureMessage(outcome)), /without confirming an accepted request/);
});

test('a blank accepted-request header is treated as absent', () => {
  assert.equal(readAcceptedRequestId(headersOf({ [LINE_ACCEPTED_REQUEST_ID_HEADER]: '   ' })), null);
  const outcome = resolveLinePushOutcome({
    ok: false, status: LINE_CONFLICT_STATUS,
    headers: headersOf({ [LINE_ACCEPTED_REQUEST_ID_HEADER]: '' }),
  });
  assert.equal(outcome.providerAccepted, false);
});

test('server errors, throttling and an unreachable provider are retryable failures', () => {
  for (const status of [500, 502, 503, 429, 400, 401]) {
    const outcome = resolveLinePushOutcome({ ok: false, status, headers: headersOf({}) });
    assert.equal(outcome.providerAccepted, false, `HTTP ${status} must not be accepted`);
    assert.match(String(linePushFailureMessage(outcome)), new RegExp(`HTTP ${status}`));
  }
  const unreachable = resolveLinePushOutcome({ ok: false, status: 0, headers: null });
  assert.equal(unreachable.providerAccepted, false);
  assert.equal(unreachable.reason, 'line_unreachable');
});

test('the header is read case-insensitively, and a missing header container is safe', () => {
  assert.equal(
    readAcceptedRequestId(headersOf({ 'X-Line-Accepted-Request-Id': 'abc' })),
    'abc',
    'HTTP header names are case-insensitive by specification',
  );
  assert.equal(readAcceptedRequestId(null), null);
  assert.equal(readAcceptedRequestId(undefined), null);
});

// ---------------------------------------------------------------------------
// B. The route: accepted-but-unrecorded must not be written down as failed
// ---------------------------------------------------------------------------

type RuntimeCall = { name: string; args: Record<string, unknown> };

function dispatchHarness(lineResponse: { status: number; headers?: Record<string, string> }) {
  const rpcCalls: RuntimeCall[] = [];
  const pushes: Array<{ headers: Record<string, string>; body: any }> = [];

  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        return {
          data: [{ id: 'row-1', shop_id: 'shop-1', event_type: 'reminder_3h', attempt_count: 1 }],
          error: null,
        };
      }
      if (name === 'get_line_notification_delivery_context') {
        return {
          data: [{
            id: 'row-1', shop_id: 'shop-1', event_type: 'reminder_3h', recipient_type: 'customer',
            attempt_count: 1, line_user_id: 'U' + 'a'.repeat(32), line_oa_id: null, shop_name: 'ร้านทดสอบ',
            subscription_plan: 'basic_490', subscription_status: 'active', current_period_end: null,
            trial_ends_at: null, monthly_push_cap: 600, booking_date: '2026-10-05',
            start_time: '14:30:00', booking_code: 'BK-1',
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };

  const send: typeof fetch = async (input: any, init: any) => {
    if (String(input).includes('/v2/bot/message/push')) {
      pushes.push({ headers: (init.headers ?? {}) as Record<string, string>, body: JSON.parse(init.body) });
      return new Response('{}', { status: lineResponse.status, headers: lineResponse.headers ?? {} });
    }
    return new Response('{}', { status: 200 });
  };

  return {
    rpcCalls, pushes, runtime, send,
    quotaTransport: { getJson: async () => ({ ok: false, status: 500, body: null }) },
    alertTransport: { send: async () => ({ ok: true, status: 200 }) },
    sink: { claim: async () => ({ claimed: true }) },
  };
}

async function withDispatchEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = {
    secret: process.env.NOTIFICATION_DISPATCH_SECRET,
    lineSecret: process.env.LINE_CHANNEL_SECRET,
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };
  process.env.NOTIFICATION_DISPATCH_SECRET = 'dispatch-secret';
  process.env.LINE_CHANNEL_SECRET = 'central-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'central-token';
  try {
    return await run();
  } finally {
    process.env.NOTIFICATION_DISPATCH_SECRET = saved.secret;
    process.env.LINE_CHANNEL_SECRET = saved.lineSecret;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = saved.lineToken;
  }
}

const dispatchRequest = () => new Request('https://bk01.test/dispatch', {
  method: 'POST', headers: { authorization: 'Bearer dispatch-secret' }, body: '',
});

function completion(harness: ReturnType<typeof dispatchHarness>) {
  return harness.rpcCalls.find((call) => call.name === 'complete_line_notification');
}

test('the push carries the outbox row id as the retry key, so a retry is deduplicated at LINE', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ status: 200 });
    await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    assert.equal(harness.pushes.length, 1);
    assert.equal(
      harness.pushes[0].headers[LINE_RETRY_KEY_HEADER], 'row-1',
      'without the stable retry key a 409 could not mean "already accepted"',
    );
  });
});

test('timeout after the provider accepted: the 409+accepted-id is recorded as SENT, not failed', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({
      status: LINE_CONFLICT_STATUS,
      headers: { [LINE_ACCEPTED_REQUEST_ID_HEADER]: 'accepted-request-42' },
    });
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.sent, 1, 'the row was accepted by LINE, so it is a sent row');
    assert.equal(body.failed, 0);
    assert.equal(body.held, 0);

    const written = completion(harness);
    assert.equal(written?.args.p_status, 'sent', 'the ledger must agree with LINE');
    assert.ok(written?.args.p_sent_at, 'a sent row carries its timestamp');
    assert.equal(written?.args.p_error_message, null, 'an accepted retry has no error to record');
    assert.equal(written?.args.p_next_retry_at, null, 'and nothing to retry');
  });
});

test('crash before the outbox write is recorded leaves the row retryable, and the retry can still be accepted', async () => {
  await withDispatchEnv(async () => {
    // Attempt 1: provider accepted but the completion write fails. The route
    // reports the failure of PERSISTENCE (503), which is exactly the state that
    // must leave the row pending so the retry key can resolve it later.
    const failing = dispatchHarness({ status: 200 });
    const failingRuntime = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'complete_line_notification') return { data: null, error: { message: 'write lost' } };
        return (failing.runtime.rpc as any)(name, args);
      },
    };
    const first = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => failingRuntime as any, failing.send,
      failing.quotaTransport as any, failing.alertTransport, async () => 0, failing.sink,
    );
    assert.equal(first.status, 500, 'the push may have gone out but was NOT recorded');
    assert.equal(failing.pushes.length, 1);

    // Attempt 2 under the same row id: LINE answers the duplicate with 409 + the
    // accepted request id, and the row is completed as sent.
    const retry = dispatchHarness({
      status: LINE_CONFLICT_STATUS,
      headers: { [LINE_ACCEPTED_REQUEST_ID_HEADER]: 'accepted-request-42' },
    });
    const second = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => retry.runtime as any, retry.send,
      retry.quotaTransport as any, retry.alertTransport, async () => 0, retry.sink,
    );
    const body = await second.json() as Record<string, any>;
    assert.equal(second.status, 200);
    assert.equal(body.sent, 1, 'the recovered attempt is a sent row');
    assert.equal(retry.pushes.length, 1, 'the retry really was re-sent under the same key');
    assert.equal(retry.pushes[0].headers[LINE_RETRY_KEY_HEADER], 'row-1', 'same key on the retry');
    assert.equal(completion(retry)?.args.p_status, 'sent');
  });
});

test('a 5xx stays a retryable failure with a pending row and a real error message', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ status: 503 });
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0);
    assert.equal(body.failed, 1);
    assert.equal(body.held, 0);
    const written = completion(harness);
    assert.equal(written?.args.p_status, 'pending', 'a provider failure is retried, not retired');
    assert.match(String(written?.args.p_error_message), /HTTP 503/);
    assert.ok(written?.args.p_next_retry_at, 'a retryable row gets a retry time');
    assert.equal(written?.args.p_sent_at, null, 'nothing was sent');
  });
});

test('an unconfirmed 409 is a failure, never silently a success', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ status: LINE_CONFLICT_STATUS });
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0, 'a 409 without an accepted id has confirmed nothing');
    assert.equal(body.failed, 1);
    const written = completion(harness);
    assert.notEqual(written?.args.p_status, 'sent');
    assert.match(String(written?.args.p_error_message), /conflicted with HTTP 409/);
  });
});

// ---------------------------------------------------------------------------
// C. The three states are named separately in the code, not collapsed
// ---------------------------------------------------------------------------

test('the outcome module keeps provider-accepted and application-recorded as separate facts', () => {
  const source = read('apps/booking-consumer/src/lib/notification-line-outcome.ts');
  // The module must not claim a delivery: it reports ACCEPTANCE, and the comment
  // explains that the retry key buys deduplicated acceptance, not exactly-once
  // delivery. A future edit that starts promising delivery has to face this text.
  assert.match(source, /deduplicated\s+ACCEPTANCE/i);
  assert.match(source, /line_conflict_unconfirmed/);
  assert.doesNotMatch(source, /console\.(?:log|error)/);
});

test('the route does not decide delivery from response.ok alone', () => {
  const route = read('apps/booking-consumer/src/lib/notification-dispatch.ts');
  assert.doesNotMatch(
    route, /delivered\s*=\s*response\.ok/,
    'the round-1 defect: a 409 that confirms acceptance would be recorded as failed',
  );
  assert.match(route, /resolveLinePushOutcome\(/);
  // The failure text is the outcome module's, so the two cannot drift.
  assert.match(route, /linePushFailureMessage\(/);
});
