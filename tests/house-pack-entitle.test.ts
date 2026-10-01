import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PLAN_NOTIFICATION_ENTITLEMENTS,
  TRIAL_ENTITLEMENT_PLAN,
  entitlementsForPlan,
  pushEntitlementColumn,
  resolveEffectivePlan,
} from '../apps/booking-consumer/src/lib/notification-entitlement.ts';
import {
  bangkokMonthKey,
  countsAgainstPushCap,
  resolvePushCapDecision,
  METERED_PUSH_EVENTS,
  UNMETERED_EVENTS,
} from '../apps/booking-consumer/src/lib/notification-push-budget.ts';

// Imported the way the integration suite imports a route module: the handler is
// exercised directly with injected transports, so no network and no database.
const dispatchRoute = await import('../apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');

/**
 * Unit 7 item 1 + 2 — HOUSE-BK01-PACK-ENTITLE (BK01 brief 25, Owner decision A-21).
 *
 * Item 1: the per-plan table. Item 2: the per-shop monthly push cap, counted over
 * the Thai calendar month, with the binding reply excluded.
 *
 * The cap is the VALUE a reviewer failed in round 1: it may be retuned by the
 * Owner, so the app keeps NO copy of it. The entitlement context the unit-7 SQL
 * builds is its only source; anything else — the plan mirror table, a literal, a
 * `?? 50` default — is a second source of truth and is pinned out below.
 *
 * What is proven here: the app-side decision, its boundary cases, and the alert
 * the route owes when the cap cannot be verified. What is NOT: that the database
 * column has the same values — the migration is a spec handed to the controller
 * and is not applied by this unit.
 */

const read = (path: string) => readFileSync(path, 'utf8');

/** Comments may cite the locked numbers as documentation; only code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CAP_LITERAL = /\b(?:50|600|1500|1,500)\b/;

// ---------------------------------------------------------------------------
// Item 1 — the per-plan table
// ---------------------------------------------------------------------------

test('the locked per-plan table matches A-21 row for row, and carries rights only', () => {
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.free, {
    customer_reminder_push: true,
    customer_slip_decision_push: false,
    shop_email_slip: false,
    shop_email_booking: false,
  });
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.basic_490, {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: false,
  });
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.pro_990, {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: true,
  });
});

test('the entitlement mirror carries NO monthly cap — the context is its only source', () => {
  // Round 1 failed because this file mirrored 50/600/1500. A mirrored value wins
  // silently whenever the SQL has not been extended, so the type and the table
  // must not be able to hold one at all.
  const source = read('apps/booking-consumer/src/lib/notification-entitlement.ts');
  assert.doesNotMatch(stripComments(source), /monthly_push_cap\s*:/, 'no cap field may exist in the mirror');
  assert.doesNotMatch(stripComments(source), /monthly_push_cap\s*\?:/, 'not even as an optional field');
  for (const plan of Object.values(PLAN_NOTIFICATION_ENTITLEMENTS)) {
    assert.deepEqual(Object.keys(plan).sort(), [
      'customer_reminder_push', 'customer_slip_decision_push', 'shop_email_booking', 'shop_email_slip',
    ]);
  }
});

test('no pack number is hard-coded in any notification module or the dispatch route', () => {
  const files = [
    'apps/booking-consumer/src/lib/notification-entitlement.ts',
    'apps/booking-consumer/src/lib/notification-push-budget.ts',
    'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    'apps/booking-consumer/src/app/api/notifications/dispatch/route.ts',
  ];
  for (const file of files) {
    assert.doesNotMatch(stripComments(read(file)), CAP_LITERAL, `${file} must not carry a cap literal (A-21: retunable)`);
  }
});

test('the trial carries the Basic entitlements, not a row of its own', () => {
  // A-21: "ทดลอง 14 วัน (สิทธิ์เท่า Basic)", through the existing `bk01_effective_plan`.
  assert.equal(TRIAL_ENTITLEMENT_PLAN, 'basic_490');
  assert.deepEqual(entitlementsForPlan(TRIAL_ENTITLEMENT_PLAN), PLAN_NOTIFICATION_ENTITLEMENTS.basic_490);

  const now = new Date('2026-10-01T06:00:00Z');
  assert.equal(resolveEffectivePlan({
    plan: 'basic_490', status: 'trialing',
    currentPeriodEnd: '2026-10-10T00:00:00Z', trialEndsAt: null, now,
  }), 'basic_490');

  // An expired trial falls back to FREE, which is the entitlement-minimal plan.
  assert.equal(resolveEffectivePlan({
    plan: 'basic_490', status: 'trialing',
    currentPeriodEnd: '2026-09-30T00:00:00Z', trialEndsAt: null, now,
  }), 'free');
});

test('an unknown plan or event fails closed instead of granting an entitlement', () => {
  assert.equal(entitlementsForPlan('free_trial'), null);
  assert.equal(entitlementsForPlan(null), null);
  assert.equal(entitlementsForPlan('enterprise'), null);
  assert.equal(pushEntitlementColumn('booking_created'), null);
  assert.equal(pushEntitlementColumn('whatever_new_event'), null);
});

test('each customer push event maps to the entitlement column A-21 names', () => {
  assert.equal(pushEntitlementColumn('reminder_3h'), 'customer_reminder_push');
  // A legacy row created before the 3-hour move keeps its pack entitlement.
  assert.equal(pushEntitlementColumn('reminder_24h'), 'customer_reminder_push');
  assert.equal(pushEntitlementColumn('deposit_rejected'), 'customer_slip_decision_push');
});

test('the route reads the rights from the database first and the mirror only as fallback', () => {
  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.match(route, /entitlementsForPlan/);
  assert.match(route, /customer_reminder_push/);
  assert.match(route, /customer_slip_decision_push/);
  // Over the pack is a suppression with a recorded reason, never a customer error.
  assert.match(route, /push_not_in_pack/);
});

test('the route takes the cap from the delivery context and from nowhere else', () => {
  const route = stripComments(read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts'));
  assert.match(route, /cap:\s*context\.monthly_push_cap/, 'the context column is the cap');
  assert.doesNotMatch(route, /entitlementsForPlan\([^)]*\)\?\.monthly_push_cap/, 'the mirror must not answer for the cap');
  assert.doesNotMatch(route, /monthly_push_cap\s*\?\?\s*\d/, 'no numeric default may stand in for the context');
});

// ---------------------------------------------------------------------------
// Item 2 — the per-shop monthly push cap
// ---------------------------------------------------------------------------

test('an unreadable count or cap does NOT mute the shop — the cost guard reports unverified', () => {
  // Deliberate direction: the cap is a budget, not a right. Suppressing a
  // paid-for reminder because a counter could not be read would be the worse
  // failure, so the send is allowed and the fact that the guard was not active is
  // reported. (Contrast `push_not_in_pack` above, which is a right and suppresses.)
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: null }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: null, used: 3 }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: undefined, used: undefined }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: -1, used: 0 }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
});

test('a confirmed count at or over the cap is the only thing that suppresses a metered push', () => {
  // The cap itself is injected: the test never reads it from the plan table.
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 0 }), { allowed: true, unverified: false });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 49 }), { allowed: true, unverified: false });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 50 }), {
    allowed: false, unverified: false, reason: 'push_cap_reached',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 51 }), {
    allowed: false, unverified: false, reason: 'push_cap_reached',
  });
});

test('the binding confirmation reply is free and never metered', () => {
  // A-21 + LINE pricing: reply is free. The confirmation is the `booking_created`
  // event on the customer path and `binding_confirmation` on the reply path.
  assert.equal(countsAgainstPushCap('booking_created'), false);
  assert.equal(countsAgainstPushCap('binding_confirmation'), false);
  assert.equal(countsAgainstPushCap('reminder_3h'), true);
  assert.equal(countsAgainstPushCap('deposit_rejected'), true);
  assert.deepEqual(METERED_PUSH_EVENTS, ['reminder_3h', 'reminder_24h', 'deposit_rejected', 'deposit_slip_decision']);
  assert.ok(UNMETERED_EVENTS.includes('binding_confirmation'));
});

test('the month window is the Thai calendar month, resetting on the 1st', () => {
  // 2026-10-01T00:00+07:00 is 2026-09-30T17:00Z — still October in Bangkok.
  assert.equal(bangkokMonthKey(new Date('2026-09-30T17:00:00Z')), '2026-10-01');
  assert.equal(bangkokMonthKey(new Date('2026-09-30T16:59:59Z')), '2026-09-01');
  assert.equal(bangkokMonthKey(new Date('2026-10-31T16:59:59Z')), '2026-10-01');
  assert.equal(bangkokMonthKey(new Date('2026-10-31T17:00:00Z')), '2026-11-01');
});

// ---------------------------------------------------------------------------
// The route-level behaviour: which channel, and what the operator is told
// ---------------------------------------------------------------------------

type RuntimeCall = { name: string; args: Record<string, unknown> };

function dispatchHarness(rows: Array<Record<string, unknown>>) {
  const rpcCalls: RuntimeCall[] = [];
  const pushes: Array<{ url: string; body: any; authorization: string }> = [];
  const alerts: Array<{ to: string; subject: string }> = [];
  const claimedKeys: string[] = [];
  const seen = new Set<string>();

  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        return { data: rows.map((row) => ({
          id: row.id, shop_id: row.shop_id, event_type: row.event_type, attempt_count: row.attempt_count ?? 1,
        })), error: null };
      }
      if (name === 'get_line_notification_delivery_context') {
        const row = rows.find((candidate) => candidate.id === args.p_id);
        return { data: row ? [row] : [], error: null };
      }
      return { data: true, error: null };
    },
  };

  const send: typeof fetch = async (input: any, init: any) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.includes('/v2/bot/message/push')) {
      pushes.push({ url, body: JSON.parse(init.body), authorization: headers.Authorization });
      return new Response('{}', { status: 200 });
    }
    // The quota endpoints are never reached: a quota transport is injected.
    return new Response('{}', { status: 200 });
  };

  return {
    rpcCalls, pushes, alerts, claimedKeys,
    runtime, send,
    quotaTransport: { getJson: async () => ({ ok: false, status: 500, body: null }) },
    alertTransport: { send: async (input: { to: string; subject: string }) => { alerts.push(input); return { ok: true, status: 200 }; } },
    // A ledger whose day keys are claimed once, like the real table.
    sink: { claim: async ({ dedupeKey }: { dedupeKey: string }) => {
      claimedKeys.push(dedupeKey);
      if (seen.has(dedupeKey)) return { claimed: false };
      seen.add(dedupeKey);
      return { claimed: true };
    } },
  };
}

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1', shop_id: 'shop-1', event_type: 'reminder_3h', recipient_type: 'customer',
    attempt_count: 1, line_user_id: 'U' + 'a'.repeat(32), line_oa_id: null, shop_name: 'ร้านทดสอบ',
    subscription_plan: 'basic_490', subscription_status: 'active', current_period_end: null, trial_ends_at: null,
    monthly_push_cap: 600, booking_date: '2026-10-02', start_time: '14:30:00', booking_code: 'BK-1',
    ...overrides,
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

test('EVERY pack sends through the central OA — the merchant OA is not on the send path', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness([
      contextRow({ id: 'free-1', shop_id: 'shop-free', subscription_plan: 'free', monthly_push_cap: 600 }),
      contextRow({ id: 'basic-1', shop_id: 'shop-basic', subscription_plan: 'basic_490' }),
      contextRow({ id: 'pro-1', shop_id: 'shop-pro', subscription_plan: 'pro_990' }),
    ]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.sent, 3, 'free, Basic and Pro reminders all go out');
    // No LINE_MERCHANT_CHANNELS_JSON is set, so a merchant send would have thrown
    // and produced `LINE dispatch is unavailable` instead of a send.
    assert.equal(harness.pushes.length, 3);
    for (const push of harness.pushes) {
      assert.equal(push.authorization, 'Bearer central-token', 'the central OA token is used for every pack');
    }
  });
});

test('the send path cannot reach the per-shop merchant resolver', async () => {
  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.doesNotMatch(route, /isMerchantPlan/);
  assert.doesNotMatch(route, /resolveMerchant(?!LineChannel)/, 'no merchant resolver is wired into the dispatcher');
  // The comment above the channel decision names the module on purpose; what must
  // not happen is the dispatcher IMPORTING or calling it.
  assert.doesNotMatch(stripComments(route), /merchant-line-config|resolveMerchantLineChannel/);
  // The module itself stays in the repository for the future.
  assert.match(read('apps/booking-consumer/src/lib/merchant-line-config.ts'), /export function resolveMerchantLineChannel/);
});

test('a cap that could not be verified is reported to OPS_ALERT_EMAIL once per run', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    // Neither the count nor the cap is readable: two rows must still send, and
    // the operator must be told exactly once that the guard is not running.
    const harness = dispatchHarness([
      contextRow({ id: 'n1', monthly_push_cap: null }),
      contextRow({ id: 'n2', monthly_push_cap: null }),
    ]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => null, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 2, 'a paid-for reminder is not muted by an unreadable counter');
    assert.equal(body.unverifiedCapChecks, 2, 'every unverified check is counted');
    assert.equal(body.held, 0);
    assert.equal(harness.alerts.length, 1, 'one alert per run, not one per row');
    assert.equal(harness.alerts[0].to, 'ops@example.com');
    assert.match(harness.alerts[0].subject, /cap could not be verified/i);
    assert.equal(harness.claimedKeys.length, 1);
    assert.match(harness.claimedKeys[0], /^push_cap_unverified:shop-1:\d{4}-\d{2}-\d{2}$/);
  });
});

test('the cap alert is limited to once per shop per Thai day', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness([contextRow({ monthly_push_cap: null })]);
    const call = () => dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => null, harness.sink,
    );
    await call();
    await call(); // A later dispatch on the same day
    await call();
    assert.equal(harness.alerts.length, 1, 'the day key is claimed once, so a busy shop cannot storm the operator');
    assert.equal(harness.claimedKeys.length, 3, 'the ledger is consulted every time');
    assert.equal(harness.pushes.length, 3, 'the pushes themselves continue');
  });
});

test('with no OPS_ALERT_EMAIL the cap alert is silent and no other channel is used', async () => {
  await withDispatchEnv(async () => {
    delete process.env.OPS_ALERT_EMAIL;
    const harness = dispatchHarness([contextRow({ monthly_push_cap: null })]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => null, harness.sink,
    );
    assert.equal((await response.json() as Record<string, any>).unverifiedCapChecks, 1);
    assert.deepEqual(harness.alerts, [], 'nothing may be sent anywhere without OPS_ALERT_EMAIL');
    // The only outbound calls are the push itself — no LINE/Telegram fallback for
    // the alert, and no quota read because a transport was injected.
    assert.equal(harness.pushes.length, 1);
  });
});

test('a confirmed count over the injected cap is suppressed and recorded, with no alert', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness([contextRow()]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport,
      // 600 is the injected cap; the injected count confirms it is reached.
      async () => 600, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0);
    assert.equal(body.held, 1);
    assert.equal(body.holdReasons.push_cap_reached, 1);
    assert.equal(body.unverifiedCapChecks, 0);
    assert.deepEqual(harness.pushes, [], 'nothing leaves when the cap is confirmed reached');
    assert.deepEqual(harness.alerts, [], 'a working guard is not an incident');
  });
});

test('the breaker alert still fires when the shared OA passes 80%, and only for Free shops', async () => {
  await withDispatchEnv(async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    const harness = dispatchHarness([
      contextRow({ id: 'free-1', shop_id: 'shop-free', subscription_plan: 'free' }),
      contextRow({ id: 'basic-1', shop_id: 'shop-basic', subscription_plan: 'basic_490' }),
    ]);
    const overQuota = {
      getJson: async (url: string) => url.endsWith('/consumption')
        ? { ok: true, status: 200, body: { totalUsage: 260 } }
        : { ok: true, status: 200, body: { type: 'limited', value: 300 } },
    };
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      overQuota as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.oaQuotaBreaker, 'open');
    assert.equal(body.held, 1);
    assert.equal(body.holdReasons.oa_quota_breaker_free_shop, 1);
    assert.equal(body.sent, 1, 'the paying shop keeps sending');
    assert.equal(harness.alerts.length, 1);
    assert.match(harness.alerts[0].subject, /quota breaker open/i);
    assert.equal(harness.claimedKeys.length, 1);
    assert.match(harness.claimedKeys[0], /^oa_breaker_open:\d{4}-\d{2}-\d{2}$/);
    assert.equal(harness.pushes.length, 1);
    assert.equal(harness.pushes[0].authorization, 'Bearer central-token');
  });
});
