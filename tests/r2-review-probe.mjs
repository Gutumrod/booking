#!/usr/bin/env node
// Fail-before / pass-after probe for the round-1 review items of
// HOUSE-BK01-PACK-NOTIFY-APP (brief 25 units 6+7, round 2).
//
// Run from a worktree root:  node --no-warnings --import ./tests/register-ts-loader.mjs tests/r2-review-probe.mjs
// It drives the real dispatcher with injected transports and prints what it finds.
// The dispatcher's parameter list changed in round 2 (the merchant resolver is gone
// and the alert ledger arrived), so the probe passes the injected arguments as a
// trailing array and adapts to whichever arity the source under test has.

const route = await import('../apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
const budget = await import('../apps/booking-consumer/src/lib/notification-push-budget.ts');
const entitlement = await import('../apps/booking-consumer/src/lib/notification-entitlement.ts');
const breaker = await import('../apps/booking-consumer/src/lib/notification-oa-breaker.ts');

const results = [];

function row(overrides = {}) {
  return {
    id: overrides.id ?? 'notification-1', shop_id: 'shop-1', event_type: 'reminder_3h', recipient_type: 'customer',
    attempt_count: 1, line_user_id: 'U' + 'a'.repeat(32), line_oa_id: null, shop_name: 'ร้านทดสอบ',
    subscription_plan: 'basic_490', subscription_status: 'active', current_period_end: null, trial_ends_at: null,
    monthly_push_cap: 600, booking_date: '2026-10-02', start_time: '14:30:00', booking_code: 'BK-1',
    ...overrides,
  };
}

function harness(rows) {
  const pushes = [];
  const alerts = [];
  const claimedKeys = [];
  const seen = new Set();
  const runtime = {
    rpc: async (name, args) => {
      if (name === 'claim_due_line_notifications') {
        return { data: rows.map((r) => ({ id: r.id, shop_id: r.shop_id, event_type: r.event_type, attempt_count: r.attempt_count ?? 1 })), error: null };
      }
      if (name === 'get_line_notification_delivery_context') {
        const found = rows.find((r) => r.id === args.p_id);
        return { data: found ? [found] : [], error: null };
      }
      return { data: true, error: null };
    },
  };
  const send = async (input, init) => {
    const url = String(input);
    if (url.includes('/v2/bot/message/push')) {
      pushes.push({ authorization: (init?.headers ?? {}).Authorization, body: JSON.parse(init.body) });
    }
    return new Response('{}', { status: 200 });
  };
  return {
    pushes, alerts, claimedKeys,
    runtime, send,
    quotaTransport: { getJson: async (url) => url.endsWith('/consumption')
      ? { ok: true, status: 200, body: { totalUsage: 10 } }
      : { ok: true, status: 200, body: { type: 'limited', value: 300 } } },
    alertTransport: { send: async (input) => { alerts.push(input); return { ok: true, status: 200 }; } },
    // A merchant resolver that FAILS, so any code path still asking for the shop
    // OA is visible as a failed delivery instead of a silent central send.
    merchantResolver: async () => { throw new Error('Merchant LINE credentials are not configured'); },
    usage: async () => 0,
    sink: { claim: async ({ dedupeKey }) => {
      claimedKeys.push(dedupeKey);
      if (seen.has(dedupeKey)) return { claimed: false };
      seen.add(dedupeKey);
      return { claimed: true };
    } },
  };
}

function dispatchRequest() {
  return new Request('https://bk01.test/dispatch', {
    method: 'POST', headers: { authorization: 'Bearer dispatch-secret' }, body: '',
  });
}

async function dispatch(handler, h, { usage, sink } = {}) {
  // The dispatcher's parameter list changed between rounds (the merchant resolver
  // was removed, the alert ledger added), so the arguments are mapped by the
  // handler's own parameter NAMES rather than by position.
  const names = (handler.toString().match(/^[^(]*\(([\s\S]*?)\)/) || [, ''])[1]
    .split(',').map((part) => part.trim().split(/[=:\s]/)[0]).filter(Boolean);
  const values = {
    req: dispatchRequest(),
    runtimeProvider: async () => h.runtime,
    send: h.send,
    resolveMerchant: h.merchantResolver,
    quotaTransport: h.quotaTransport,
    alertTransport: h.alertTransport,
    resolvePushUsage: usage ?? h.usage,
    capAlertSink: sink ?? h.sink,
  };
  return handler(...names.map((name) => values[name]));
}

async function run(label, fn) {
  const saved = {
    secret: process.env.NOTIFICATION_DISPATCH_SECRET,
    lineSecret: process.env.LINE_CHANNEL_SECRET,
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    ops: process.env.OPS_ALERT_EMAIL,
    merchant: process.env.LINE_MERCHANT_CHANNELS_JSON,
  };
  process.env.NOTIFICATION_DISPATCH_SECRET = 'dispatch-secret';
  process.env.LINE_CHANNEL_SECRET = 'central-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'central-token';
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  delete process.env.LINE_MERCHANT_CHANNELS_JSON;
  try {
    results.push({ label, ...(await fn()) });
  } catch (error) {
    results.push({ label, error: error.message });
  } finally {
    process.env.NOTIFICATION_DISPATCH_SECRET = saved.secret;
    process.env.LINE_CHANNEL_SECRET = saved.lineSecret;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = saved.lineToken;
    process.env.OPS_ALERT_EMAIL = saved.ops;
    if (saved.merchant === undefined) delete process.env.LINE_MERCHANT_CHANNELS_JSON;
    else process.env.LINE_MERCHANT_CHANNELS_JSON = saved.merchant;
  }
}

// P1 — A-21: every pack uses the central OA. On the pre-fix source the Basic and
// Pro rows take the merchant path and cannot be delivered at all.
await run('P1 every pack sends through the central OA', async () => {
  const h = harness([
    row({ id: 'free-1', shop_id: 'shop-free', subscription_plan: 'free' }),
    row({ id: 'basic-1', shop_id: 'shop-basic', subscription_plan: 'basic_490' }),
    row({ id: 'pro-1', shop_id: 'shop-pro', subscription_plan: 'pro_990' }),
  ]);
  const body = await (await dispatch(route.handleNotificationDispatch, h)).json();
  return {
    sent: body.sent,
    failed: body.failed,
    pushes: h.pushes.length,
    allCentral: h.pushes.every((p) => p.authorization === 'Bearer central-token'),
  };
});

// P2 — the cap comes from the entitlement context only. With the context column
// absent, the pre-fix source answered from its own mirror (50 for free) and called
// the check verified; the round-2 source reports it unverified, alerts OPS and
// still sends.
await run('P2 an absent cap in the context is unverified, not a mirrored number', async () => {
  const h = harness([row({ id: 'n1', shop_id: 'shop-free', subscription_plan: 'free', monthly_push_cap: null })]);
  const body = await (await dispatch(route.handleNotificationDispatch, h)).json();
  return {
    sent: body.sent,
    unverifiedCapChecks: body.unverifiedCapChecks,
    alerts: h.alerts.length,
    alertSubject: h.alerts[0]?.subject ?? null,
  };
});

// P3 — the cap alert is limited to once per Thai day.
await run('P3 the cap alert is limited to once per Thai day', async () => {
  const h = harness([row({ id: 'n1', monthly_push_cap: null })]);
  const call = () => dispatch(route.handleNotificationDispatch, h, { usage: async () => null });
  await call();
  await call();
  await call();
  return { alerts: h.alerts.length, pushes: h.pushes.length, claimedKeys: h.claimedKeys.length };
});

// P4 — the mirror must not be able to hold a cap at all.
results.push({
  label: 'P4 the entitlement mirror carries no monthly cap',
  mirrorCap: entitlement.PLAN_NOTIFICATION_ENTITLEMENTS.free.monthly_push_cap ?? null,
});

// P5 — the alert ledger helper exists and is keyed on the Thai day.
results.push({
  label: 'P5 the alert day key helper exists',
  hasDayKey: typeof breaker.bangkokDayKey === 'function',
  hasDedupeKey: typeof breaker.pushAlertDedupeKey === 'function',
});

// P6 — the metering decision, driven by injected numbers.
results.push({
  label: 'P6 injectable cap boundary',
  at49: budget.resolvePushCapDecision({ cap: 50, used: 49 }),
  at50: budget.resolvePushCapDecision({ cap: 50, used: 50 }),
  noCap: budget.resolvePushCapDecision({ cap: null, used: 0 }),
});

for (const result of results) console.log(JSON.stringify(result));
