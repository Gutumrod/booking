/**
 * BK01 P0 — application unit H2 (council finding G21).
 *
 * WHAT FAILED. The route built its usage resolver as
 *
 *     const usageResolver = resolvePushUsage ?? (async () => null);
 *
 * and NOTHING in the app ever injected one, so `used` was `null` on every real
 * dispatch. `resolvePushCapDecision` then classified every metered send as
 * `unverified`, which by design ALLOWS the send — so the monthly push cap never
 * engaged, a Free shop could push without limit, and the operator got one
 * "cap could not be verified" alert per shop per day forever.
 *
 * WHAT IS PROVEN HERE. The count now comes from the delivery context, which is a
 * column the unit-7 SQL already returns (`push_used_this_month`). These cases drive
 * the REAL route with a fake runtime and a fake LINE transport and assert on what
 * LEFT and what was WRITTEN BACK:
 *
 *   - a context that reports the count stopping a shop at its cap (no push, held);
 *   - a context whose count still has room letting the send through as verified;
 *   - an ABSENT count staying `unverified` (allowed + reported) — the deliberate
 *     cost-guard direction, asserted so a future edit cannot quietly flip it to
 *     "suppress" and mute a paying shop's reminder;
 *   - an injected resolver still taking precedence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePushCapDecision } from '../apps/booking-consumer/src/lib/notification-push-budget.ts';

// The handler lives in a library module now (the route module may export only HTTP
// methods), so the real dispatcher is imported from the module that implements it.
const dispatchRoute = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');

type RuntimeCall = { name: string; args: Record<string, unknown> };

/**
 * A REAL lowercase shop UUID. `pushAlertDedupeKey` refuses any shop segment that
 * is not a `shops.id` UUID (`{ ok: false, reason: 'shop_id_invalid' }`), so a
 * display slug would mean NO key, no alert and nothing to assert on.
 */
const SHOP_UUID = '3f1e2d4c-0000-4000-8000-000000000001';

type LedgerCall = { kind: string; key: string; delivered: boolean };
type AlertCall = { to: string; subject: string; text: string; idempotencyKey: string };

/**
 * The harness drives the REAL route. The alert ledger below is the two-phase
 * contract of `local_service.claim_due_shop_email_notifications` in ALERT MODE:
 *
 *   claim({ delivered: false })  — CLAIM. `claimed: true` is the ONLY thing that
 *                                  authorises a send. An undelivered claim leases
 *                                  the key, so it stays retryable.
 *   claim({ delivered: true })   — ACKNOWLEDGEMENT after the provider accepted the
 *                                  mail. It returns claimed=false/delivered=true
 *                                  and never authorises another send.
 *
 * `transportBehaviour` lets a case make the operator transport FAIL or THROW, which
 * is how the "no acknowledgement without a delivered mail" direction is proven.
 */
function dispatchHarness(
  contextOverrides: Record<string, unknown>,
  options: { transportBehaviour?: 'ok' | 'fail' | 'throw' } = {},
) {
  const rpcCalls: RuntimeCall[] = [];
  const pushes: Array<{ body: any }> = [];
  const alerts: AlertCall[] = [];
  const ledgerCalls: LedgerCall[] = [];
  const claimed = new Set<string>();
  const delivered = new Set<string>();

  const context = {
    id: 'row-1', shop_id: SHOP_UUID, event_type: 'reminder_3h', recipient_type: 'customer',
    attempt_count: 1, line_user_id: 'U' + 'a'.repeat(32), line_oa_id: null, shop_name: 'ร้านทดสอบ',
    subscription_plan: 'free', subscription_status: 'active', current_period_end: null,
    trial_ends_at: null, monthly_push_cap: 50, booking_date: '2026-10-05', start_time: '14:30:00',
    booking_code: 'BK-1',
    ...contextOverrides,
  };

  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        return {
          data: [{ id: 'row-1', shop_id: SHOP_UUID, event_type: context.event_type, attempt_count: 1 }],
          error: null,
        };
      }
      if (name === 'get_line_notification_delivery_context') return { data: [context], error: null };
      return { data: true, error: null };
    },
  };

  const send: typeof fetch = async (input: any, init: any) => {
    if (String(input).includes('/v2/bot/message/push')) {
      pushes.push({ body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const mutable = { behaviour: options.transportBehaviour ?? 'ok' };
  const alertTransport = {
    async send(input: AlertCall) {
      if (mutable.behaviour === 'throw') throw new Error('operator transport exploded');
      if (mutable.behaviour === 'fail') return { ok: false, status: 500, error: 'provider refused' };
      alerts.push(input);
      return { ok: true, status: 200 };
    },
  };
  /** A later run may use a healthy operator transport on the SAME ledger. */
  const setNextTransportBehaviour = (next: 'ok' | 'fail' | 'throw') => { mutable.behaviour = next; };

  const sink = {
    async claim({ kind, key, delivered: acknowledged }: { kind: string; key: string; delivered: boolean }) {
      ledgerCalls.push({ kind, key, delivered: acknowledged });
      if (acknowledged) {
        if (!claimed.has(key)) throw new Error('acknowledgement without a prior claim');
        delivered.add(key);
        return { claimed: false, delivered: true };
      }
      if (claimed.has(key) || delivered.has(key)) return { claimed: false, delivered: delivered.has(key) };
      claimed.add(key);
      return { claimed: true, delivered: false };
    },
  };

  /**
   * Let every UNACKNOWLEDGED claim's lease elapse, so a run that already claimed
   * the key may claim it again. Delivered keys are NOT released — an acknowledged
   * alert is retired for the Thai day. This models the five-minute lease the SQL
   * contract documents; without it two runs milliseconds apart cannot show whether
   * a failed send stayed retryable.
   */
  const releaseLeases = () => {
    const stale: string[] = [];
    claimed.forEach((key) => { if (!delivered.has(key)) stale.push(key); });
    for (const key of stale) claimed.delete(key);
  };

  return {
    rpcCalls, pushes, alerts, ledgerCalls, claimed, delivered, releaseLeases,
    runtime, send, alertTransport, sink, setNextTransportBehaviour,
    quotaTransport: { getJson: async () => ({ ok: false, status: 500, body: null }) },
    /** A READABLE quota, so the ONLY alert any case here can raise is the cap one. */
    quotaReadable: {
      getJson: async (url: string) => url.endsWith('/consumption')
        ? { ok: true, status: 200, body: { totalUsage: 10 } }
        : { ok: true, status: 200, body: { type: 'limited', value: 300 } },
    },
  };
}

async function withDispatchEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = {
    secret: process.env.NOTIFICATION_DISPATCH_SECRET,
    lineSecret: process.env.LINE_CHANNEL_SECRET,
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    ops: process.env.OPS_ALERT_EMAIL,
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
    process.env.OPS_ALERT_EMAIL = saved.ops;
  }
}

const dispatchRequest = () => new Request('https://bk01.test/dispatch', {
  method: 'POST', headers: { authorization: 'Bearer dispatch-secret' }, body: '',
});

/** The route with NO injected resolver — the real production call shape. */
function callWithNoInjectedResolver(harness: ReturnType<typeof dispatchHarness>) {
  return dispatchRoute.handleNotificationDispatch(
    dispatchRequest(), async () => harness.runtime as any, harness.send,
    harness.quotaTransport as any, harness.alertTransport,
    // omit the alert sink / resolver defaults deliberately: this is `POST`'s path
  );
}

test('WITHOUT an injected resolver the context count is used — the cap stops the shop', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: 50 });
    const response = await callWithNoInjectedResolver(harness);
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.sent, 0, 'a shop confirmed AT its cap must not be pushed');
    assert.equal(harness.pushes.length, 0, 'nothing left');
    assert.equal(body.held, 1, 'the row is held with the cap reason, not retried as a failure');
    assert.equal(body.holdReasons.push_cap_reached, 1);
    assert.equal(body.unverifiedCapChecks, 0, 'the guard WAS active, so nothing is unverified');
  });
});

test('a context count below the cap lets the send through as a verified check', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: 49 });
    const response = await callWithNoInjectedResolver(harness);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 1, 'the 50th push is still allowed (used < cap)');
    assert.equal(harness.pushes.length, 1);
    assert.equal(body.unverifiedCapChecks, 0, 'a readable counter means the guard is live');
    assert.equal(body.held, 0);
  });
});

test('an ABSENT count is unverified — allowed AND reported, never silenced', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const alerts: Array<{ subject: string }> = [];
    // A READABLE quota, so the only alert raised here is the cap one.
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: null });
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      { getJson: async (url: string) => url.endsWith('/consumption')
        ? { ok: true, status: 200, body: { totalUsage: 10 } }
        : { ok: true, status: 200, body: { type: 'limited', value: 300 } } } as any,
      { send: async (input: { subject: string }) => { alerts.push(input); return { ok: true, status: 200 }; } },
      undefined,
      harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 1, 'a counter we cannot read must not mute a paid-for reminder');
    assert.equal(body.unverifiedCapChecks, 1, 'and the blindness must be reported');
    assert.equal(alerts.length, 1, 'the operator is told the guard is not active');
    assert.match(alerts[0].subject, /cap could not be verified/i);
  });
});

test('a shared OA quota that cannot be read is reported ONCE, even with an unconfigured token', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const alerts: Array<{ subject: string }> = [];
    // F3: the breaker fails towards SENDING (correct), but it must not fail
    // SILENTLY — an unreadable quota is a guard that is not running, exactly like
    // an unreadable push count.
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: 5 });
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      { getJson: async () => ({ ok: false, status: 500, body: null }) } as any,
      { send: async (input: { subject: string }) => { alerts.push(input); return { ok: true, status: 200 }; } },
      undefined,
      harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.oaQuotaReadStatus, 'unavailable');
    assert.equal(body.oaQuotaBreaker, 'closed', 'an unmeasurable quota must not mute anyone');
    assert.equal(response.status, 200);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].subject, /quota could not be read/i);
    assert.equal(harness.pushes.length, 1, 'and the push itself still goes out');
  });
});

test('a count that is present but nonsense is treated as unreadable, not as zero', async () => {
  await withDispatchEnv(async () => {
    for (const nonsense of ['50', -1, Number.NaN, undefined]) {
      const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: nonsense });
      const response = await callWithNoInjectedResolver(harness);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.sent, 1, `${String(nonsense)} must not be read as "at the cap"`);
      assert.equal(body.unverifiedCapChecks, 1, `${String(nonsense)} must be reported as unverified`);
    }
  });
});

test('an explicitly injected resolver still wins over the context column', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: 3 });
    const seen: string[] = [];
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport,
      async (shopId: string) => { seen.push(shopId); return 50; },
      harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(seen, [SHOP_UUID], 'the injected resolver was consulted');
    assert.equal(body.sent, 0, 'and its answer won: the shop is at the cap');
    assert.equal(body.holdReasons.push_cap_reached, 1);
  });
});

test('the cap decision itself is unchanged — H2 wires the counter, it does not re-rule the boundary', () => {
  // The boundary the controller approved on 2026-10-01 (used >= cap suppresses, an
  // unreadable count passes) is a decision, not an implementation detail, so it is
  // asserted directly here as well as through the route above.
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 49 }), { allowed: true, unverified: false });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 50 }), {
    allowed: false, unverified: false, reason: 'push_cap_reached',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: null }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
});

// ---------------------------------------------------------------------------
// The two-phase alert ledger, driven through the REAL route and REAL
// `sendOpsAlert` with a fake sink and a fake operator transport. The external
// e-mail itself is NOT MEASURABLE here (no OPS_ALERT_EMAIL, no Resend key), so the
// claim/send/acknowledge order is what is proven, not a delivered message.
// ---------------------------------------------------------------------------

const CAP_KEY = new RegExp(`^push_cap_unverified:${SHOP_UUID}:\\d{4}-\\d{2}-\\d{2}$`);

/** One dispatch with a readable quota, so the cap alert is the only one raised. */
function dispatchWithFakeOperator(harness: ReturnType<typeof dispatchHarness>) {
  return dispatchRoute.handleNotificationDispatch(
    dispatchRequest(), async () => harness.runtime as any, harness.send,
    harness.quotaReadable as any, harness.alertTransport, undefined, harness.sink,
  );
}

test('an operator alert is SENT only when the claim returned claimed=true', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: null });
    const body = await (await dispatchWithFakeOperator(harness)).json() as Record<string, any>;
    assert.equal(body.unverifiedCapChecks, 1, 'the guard was not running, so the check is unverified');

    // CLAIM first, and only `claimed: true` authorises the send.
    const claim = harness.ledgerCalls[0];
    assert.equal(claim.delivered, false, 'the first ledger call is the CLAIM');
    assert.equal(claim.kind, 'cap_unverified', 'the kind travels with the key');
    assert.match(claim.key, CAP_KEY, 'the key names the shop UUID and the Thai day');
    assert.equal(harness.alerts.length, 1, 'the claim came back true, so one alert left');
    assert.equal(
      harness.alerts[0].idempotencyKey, `cap_unverified:${claim.key}`,
      'the provider idempotency key is derived from the kind and the ledger key',
    );

    // ACKNOWLEDGE after the provider accepted the mail.
    assert.equal(harness.ledgerCalls.length, 2, 'one claim and one acknowledgement');
    assert.equal(harness.ledgerCalls[1].delivered, true, 'the second ledger call is the ACKNOWLEDGEMENT');
    assert.equal(harness.ledgerCalls[1].key, claim.key, 'the same key is acknowledged');
    assert.ok(harness.delivered.has(claim.key), 'the key is now retired for the Thai day');
  });
});

test('a send that fails or throws is NOT acknowledged, so the key stays retryable', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    for (const behaviour of ['fail', 'throw'] as const) {
      const harness = dispatchHarness(
        { monthly_push_cap: 50, push_used_this_month: null },
        { transportBehaviour: behaviour },
      );

      await dispatchWithFakeOperator(harness);
      assert.equal(harness.alerts.length, 0, `${behaviour}: nothing was delivered`);
      assert.equal(harness.delivered.size, 0, `${behaviour}: a send that never landed must NOT be acknowledged`);
      assert.equal(
        harness.ledgerCalls.at(-1)?.delivered, false,
        `${behaviour}: the last ledger call is a claim, not an acknowledgement`,
      );
      const claimedKey = harness.ledgerCalls[0].key;
      assert.match(claimedKey, CAP_KEY);

      // The five-minute lease elapses, and a later run with a healthy transport must
      // be able to deliver the SAME alert on the SAME stable key.
      harness.releaseLeases();
      harness.setNextTransportBehaviour('ok');
      await dispatchWithFakeOperator(harness);
      assert.equal(harness.alerts.length, 1, `${behaviour}: the retry delivered the alert`);
      assert.equal(
        harness.alerts[0].idempotencyKey, `cap_unverified:${claimedKey}`,
        `${behaviour}: the retry reuses the stable key rather than minting a new one`,
      );
      assert.ok(harness.delivered.has(claimedKey), `${behaviour}: the retry acknowledged the key`);
    }
  });
});

test('a claimed-and-acknowledged alert is never sent twice', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness({ monthly_push_cap: 50, push_used_this_month: null });

    await dispatchWithFakeOperator(harness);
    assert.equal(harness.alerts.length, 1);
    assert.equal(
      harness.ledgerCalls.filter((call) => call.delivered === true).length, 1,
      'exactly one acknowledgement was written',
    );
    const key = harness.ledgerCalls[0].key;

    // A later dispatch on the same Thai day finds a DELIVERED key: the claim is
    // refused, no acknowledgement is owed, and nothing is mailed a second time.
    const before = harness.ledgerCalls.length;
    await dispatchWithFakeOperator(harness);
    assert.equal(harness.alerts.length, 1, 'an acknowledged alert is never re-sent');
    assert.equal(harness.ledgerCalls.length, before + 1, 'the second run makes exactly one ledger call — the claim');
    assert.equal(harness.ledgerCalls.at(-1)?.delivered, false, 'and it is a claim, not an acknowledgement');
    assert.equal(harness.ledgerCalls.at(-1)?.key, key, 'on the same key');
  });
});
