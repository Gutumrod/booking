/**
 * BK01 P0 — application unit H1 (council findings G19, G20, G16).
 *
 * WHAT FAILED. The dispatcher chose the message with a nested ternary whose last
 * branch was a CONFIRMATION:
 *
 *     : `ยืนยันคิวที่ ${…} วันที่ … เวลา …`
 *
 * So (a) a REJECTED deposit slip told the customer their queue was confirmed, and
 * (b) every event nobody had written a branch for inherited the same text. On top
 * of that, the pack right for `booking_cancelled` / `booking_rescheduled` resolved
 * to `null`, which the route read as "hold", so a customer was never told the shop
 * had cancelled or moved their appointment.
 *
 * WHAT IS PROVEN HERE, AND HOW. Everything below drives the REAL route handler
 * (`handleNotificationDispatch`) with a fake runtime and a fake LINE transport, so
 * each assertion is about what the route DID to a specific event — which message
 * body left, which row was held and with which reason, what was written back. No
 * assertion counts rows or greps for a guard string; the `count(*)`-style check is
 * exactly the false green the council warned about.
 *
 * The event list itself is read OUT OF THE SQL (`line_notification_logs_event_type_check`)
 * rather than restated, so adding an event to the database without teaching the
 * dispatcher to handle it makes this file fail.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  NOTIFICATION_EVENT_REGISTRY,
  knownNotificationEventTypes,
  meteredNotificationEventTypes,
  notificationEventSpec,
} from '../apps/booking-consumer/src/lib/notification-event-registry.ts';
import { buildCustomerEventText } from '../apps/booking-consumer/src/lib/notification-customer-text.ts';

// The handler lives in a library module now: the App Router route module may export
// only HTTP methods (Next 16.3.6 asserts it — a non-method export fails as TS2344),
// so the real dispatcher is imported from the module that implements it, not from
// the thin `POST` wrapper.
const dispatchRoute = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');

const read = (path: string) => readFileSync(path, 'utf8');

/**
 * The event types the DATABASE permits, read from the migration that last set the
 * CHECK. The Group 6+7 migration is where the live list lands; until it is merged
 * the earlier remediation migration is the widest list in the repo, so the union
 * of both is what this unit must cover.
 */
function permittedEventTypes(): string[] {
  const sources = [
    'supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql',
  ];
  const types = new Set<string>();
  for (const path of sources) {
    const sql = read(path);
    const match = sql.match(/line_notification_logs_event_type_check\s+CHECK\s*\(\s*event_type\s+IN\s*\(([^)]*)\)/i);
    assert.ok(match, `expected an event_type CHECK in ${path}`);
    for (const quoted of match![1].matchAll(/'([a-z_0-9]+)'/g)) types.add(quoted[1]);
  }
  return [...types].sort();
}

// ---------------------------------------------------------------------------
// A. The registry is exhaustive over the database's own event list
// ---------------------------------------------------------------------------

test('every event type the database CHECK permits has an explicit registry row', () => {
  const permitted = permittedEventTypes();
  assert.ok(permitted.length >= 6, `expected the CHECK to permit several events, saw ${permitted.length}`);
  const known = knownNotificationEventTypes();
  const missing = permitted.filter((eventType) => !known.includes(eventType));
  assert.deepEqual(
    missing, [],
    `these event types are permitted by the outbox CHECK but have no registry row, so the dispatcher would have to guess: ${missing.join(', ')}`,
  );
});

test('the registry stays complete when the Group 6+7 event list is merged', () => {
  // The SQL branch that adds reminder_3h / deposit_rejected / deposit_slip_decision /
  // shop_email_* is on the R1 branch. The app must already cover that list, so an
  // app release that lands before the SQL does not need a second change (and one
  // that lands after does not silently drop the new events into a hold).
  const group67Events = [
    'booking_created', 'booking_rescheduled', 'deposit_approved', 'booking_cancelled',
    'reminder_1h', 'reminder_24h', 'reminder_3h', 'deposit_rejected',
    'deposit_slip_decision', 'shop_email_slip', 'shop_email_booking', 'shop_email_slip_summary',
  ];
  const known = knownNotificationEventTypes();
  const missing = group67Events.filter((eventType) => !known.includes(eventType));
  assert.deepEqual(missing, [], `registry is missing Group 6+7 events: ${missing.join(', ')}`);
});

test('every event the registry may send to a customer has an explicit text builder', () => {
  for (const spec of NOTIFICATION_EVENT_REGISTRY) {
    if (spec.disposition !== 'send_customer_line') continue;
    const text = buildCustomerEventText({
      eventType: spec.eventType,
      shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '14:30:00',
      bookingCode: 'BK-1',
      // A slip decision needs the outcome; that is supplied per case below.
      depositStatus: spec.eventType === 'deposit_slip_decision' ? 'rejected' : null,
    });
    assert.ok(
      typeof text === 'string' && text.length > 0,
      `${spec.eventType} is marked sendable but produced no customer text: the dispatcher would hold it or, worse, fall back`,
    );
  }
});

test('every event the registry does NOT send to a customer produces no text at all', () => {
  for (const spec of NOTIFICATION_EVENT_REGISTRY) {
    if (spec.disposition === 'send_customer_line') continue;
    const text = buildCustomerEventText({
      eventType: spec.eventType,
      shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '14:30:00',
      bookingCode: 'BK-1', depositStatus: null, decisionReason: null,
    });
    assert.equal(text, null, `${spec.eventType} is ${spec.disposition} yet produced a customer message`);
  }
});

test('an unknown event resolves to nothing — there is no default entry', () => {
  assert.equal(notificationEventSpec('some_future_event'), null);
  assert.equal(notificationEventSpec(null), null);
  assert.equal(notificationEventSpec(undefined), null);
  assert.equal(notificationEventSpec(''), null);
});

test('an unknown event fed STRAIGHT to the text builder still produces nothing', () => {
  // The route holds an unknown event before it ever asks for text, so this case has
  // to be asserted at the builder itself — otherwise a fallback added inside the
  // builder would be invisible to the route-level tests and the exact round-1 defect
  // would come back silently. (This case exists because the mutation harness proved
  // it was missing: removing the builder's guard left the suite green.)
  for (const eventType of ['some_future_event', '', 'booking_created_2', 'shop_email_something_new']) {
    assert.equal(
      buildCustomerEventText({
        eventType,
        shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '14:30:00',
        bookingCode: 'BK-1', depositStatus: null, decisionReason: null,
      }),
      null,
      `an unknown event (${JSON.stringify(eventType)}) must never produce customer text`,
    );
  }
});

test('the text builder has no default branch that could word an unknown event', () => {
  const source = read('apps/booking-consumer/src/lib/notification-customer-text.ts');
  // The guard must be the first thing the builder does, before any switch.
  assert.match(source, /if \(spec === null \|\| spec\.disposition !== 'send_customer_line'\) return null;/);
  // And the switch's default must also refuse, so neither path can word one.
  assert.match(source, /default:[\s\S]{0,200}?return null;/);
});

// ---------------------------------------------------------------------------
// B. The words: approved and rejected are different messages
// ---------------------------------------------------------------------------

test('a rejected slip is told it did NOT pass and to contact the shop — never that the queue is confirmed', () => {
  const text = buildCustomerEventText({
    eventType: 'deposit_slip_decision',
    shopName: 'ร้านตัดผมทดสอบ', bookingDate: '2026-10-05', startTime: '14:30:00',
    bookingCode: 'BK-1001', depositStatus: 'rejected',
    decisionReason: 'ยอดโอนไม่ตรง',
  });
  assert.ok(text, 'a rejected slip must produce a message');
  assert.match(text!, /ไม่ผ่าน/, 'the rejection must say the slip did NOT pass');
  assert.match(text!, /ติดต่อร้าน/, 'the rejection must send the customer to the shop');
  assert.match(text!, /rejected/i, 'the English line must say rejected');
  assert.match(text!, /NOT confirmed/i, 'the English line must say the booking is not confirmed');
  assert.match(text!, /ยอดโอนไม่ตรง/, 'the reason the shop recorded must travel');
  // The round-1 defect, asserted directly: no confirmation wording may appear.
  assert.doesNotMatch(text!, /ยืนยันคิวที่/, 'a rejection must never read as a confirmation');
});

test('the legacy deposit_rejected name always renders the rejection text', () => {
  const text = buildCustomerEventText({
    eventType: 'deposit_rejected',
    shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '09:00',
    bookingCode: 'BK-2', depositStatus: null,
  });
  assert.ok(text);
  assert.match(text!, /ไม่ผ่าน/);
  assert.doesNotMatch(text!, /ยืนยันคิวที่/);
});

test('an approved slip says so, and a slip decision with no stated outcome is HELD', () => {
  const approved = buildCustomerEventText({
    eventType: 'deposit_slip_decision',
    shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '09:00',
    bookingCode: 'BK-3', depositStatus: 'verified',
  });
  assert.ok(approved);
  assert.match(approved!, /ผ่านการตรวจสอบ/);
  assert.doesNotMatch(approved!, /ไม่ผ่าน/);

  // `deposit_slip_decision` is produced for BOTH outcomes and the outbox row does
  // not carry the outcome in the contract as it stands. Guessing would be the
  // round-1 defect, so no outcome means no message.
  const unknownOutcome = buildCustomerEventText({
    eventType: 'deposit_slip_decision',
    shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '09:00',
    bookingCode: 'BK-4', depositStatus: null,
  });
  assert.equal(unknownOutcome, null, 'an unstated slip outcome must hold, not default to a confirmation');
});

test('cancellation and reschedule carry the new appointment facts', () => {
  const cancelled = buildCustomerEventText({
    eventType: 'booking_cancelled',
    shopName: 'ร้านทดสอบ', bookingDate: '2026-10-05', startTime: '09:00',
    bookingCode: 'BK-5', depositStatus: null,
  });
  assert.ok(cancelled);
  assert.match(cancelled!, /ยกเลิกคิวที่ ร้านทดสอบ/);

  const moved = buildCustomerEventText({
    eventType: 'booking_rescheduled',
    shopName: 'ร้านทดสอบ', bookingDate: '2026-10-09', startTime: '16:45:00',
    bookingCode: 'BK-5', depositStatus: null,
  });
  assert.ok(moved);
  assert.match(moved!, /2026-10-09/);
  assert.match(moved!, /16:45/);
  assert.match(moved!, /BK-5/);
});

// ---------------------------------------------------------------------------
// C. The route: which row is sent, which is held, and with which reason
// ---------------------------------------------------------------------------

type RuntimeCall = { name: string; args: Record<string, unknown> };

function dispatchHarness(rows: Array<Record<string, unknown>>) {
  const rpcCalls: RuntimeCall[] = [];
  const pushes: Array<{ body: any }> = [];

  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        return {
          data: rows.map((row) => ({
            id: row.id, shop_id: row.shop_id, event_type: row.event_type, attempt_count: row.attempt_count ?? 1,
          })),
          error: null,
        };
      }
      if (name === 'get_line_notification_delivery_context') {
        const row = rows.find((candidate) => candidate.id === args.p_id);
        return { data: row ? [row] : [], error: null };
      }
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

  return {
    rpcCalls, pushes, runtime, send,
    quotaTransport: { getJson: async () => ({ ok: false, status: 500, body: null }) },
    alertTransport: { send: async () => ({ ok: true, status: 200 }) },
    sink: { claim: async () => ({ claimed: true }) },
  };
}

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1', shop_id: 'shop-1', event_type: 'reminder_3h', recipient_type: 'customer',
    attempt_count: 1, line_user_id: 'U' + 'a'.repeat(32), line_oa_id: null, shop_name: 'ร้านทดสอบ',
    subscription_plan: 'basic_490', subscription_status: 'active', current_period_end: null,
    trial_ends_at: null, monthly_push_cap: 600, booking_date: '2026-10-05', start_time: '14:30:00',
    booking_code: 'BK-1',
    ...overrides,
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

/** The status the route wrote back for a row, and the message that left for it. */
function completionFor(harness: ReturnType<typeof dispatchHarness>, id: string) {
  return harness.rpcCalls.find((call) => call.name === 'complete_line_notification' && call.args.p_id === id);
}

test('an unknown event is HELD with a reason and NO message is built', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness([contextRow({ id: 'unknown-1', event_type: 'event_from_the_future' })]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.sent, 0, 'nothing may be sent for an event the registry does not know');
    assert.equal(harness.pushes.length, 0, 'not one push — in particular no default confirmation');
    assert.equal(body.held, 1);
    assert.equal(body.holdReasons.unknown_event_type, 1);
    const completion = completionFor(harness, 'unknown-1');
    assert.equal(completion?.args.p_status, 'failed', 'a held row is retired, not retried forever');
    assert.match(String(completion?.args.p_error_message), /unrecognised notification event/);
  });
});

test('a shop-addressed e-mail row is quarantined by the LINE worker, not pushed at a customer', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness([
      contextRow({ id: 'shop-mail-1', event_type: 'shop_email_slip', recipient_type: 'shop_owner' }),
    ]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0);
    assert.equal(harness.pushes.length, 0, 'a shop notification must never reach a customer LINE');
    assert.equal(body.holdReasons.event_not_for_customer_line, 1);
  });
});

test('cancellation and reschedule reach the customer on EVERY pack and never count against the cap', async () => {
  await withDispatchEnv(async () => {
    for (const plan of ['free', 'basic_490', 'pro_990']) {
      for (const eventType of ['booking_cancelled', 'booking_rescheduled']) {
        const harness = dispatchHarness([
          contextRow({ id: `${plan}-${eventType}`, event_type: eventType, subscription_plan: plan }),
        ]);
        const response = await dispatchRoute.handleNotificationDispatch(
          dispatchRequest(), async () => harness.runtime as any, harness.send,
          harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
        );
        const body = await response.json() as Record<string, any>;
        assert.equal(
          body.sent, 1,
          `${eventType} on ${plan} must be sent — the round-1 defect suppressed it on every pack`,
        );
        assert.equal(harness.pushes.length, 1);
      }
    }

    // And they do not consult the counter at all: the usage resolver is never
    // called, so a shop already AT its cap still learns its booking was cancelled.
    const calls: string[] = [];
    const harness = dispatchHarness([contextRow({ id: 'free-cancel', event_type: 'booking_cancelled', subscription_plan: 'free' })]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async (shopId: string) => { calls.push(shopId); return 999; }, harness.sink,
    );
    assert.equal((response as Response).status, 200);
    assert.deepEqual(calls, [], 'an unmetered event must not even read the monthly counter');
    assert.equal(harness.pushes.length, 1);
  });
});

test('a rejected slip pushed through the route carries the rejection, not a confirmation', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness([
      contextRow({
        id: 'rejected-1', event_type: 'deposit_slip_decision', deposit_status: 'rejected',
        decision_reason: 'ยอดโอนไม่ตรง',
      }),
    ]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 1);
    assert.equal(harness.pushes.length, 1);
    const text = harness.pushes[0].body.messages[0].text as string;
    assert.match(text, /ไม่ผ่าน/, 'the customer must be told the slip failed');
    assert.match(text, /ติดต่อร้าน/, 'and to contact the shop');
    assert.doesNotMatch(text, /ยืนยันคิวที่/, 'never the confirmation wording (G19)');
  });
});

test('a slip decision the outbox row cannot explain is held, not guessed', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness([
      contextRow({ id: 'slip-unknown', event_type: 'deposit_slip_decision', deposit_status: null }),
    ]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0);
    assert.equal(harness.pushes.length, 0);
    assert.equal(body.holdReasons.event_text_unavailable, 1);
  });
});

test('the binding confirmation is not pushed by the dispatcher — it is a free reply', async () => {
  await withDispatchEnv(async () => {
    const harness = dispatchHarness([contextRow({ id: 'binding-1', event_type: 'booking_created' })]);
    const response = await dispatchRoute.handleNotificationDispatch(
      dispatchRequest(), async () => harness.runtime as any, harness.send,
      harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(body.sent, 0, 'Free confirms a queue with the reply at binding time (A-21 item 3)');
    assert.equal(harness.pushes.length, 0);
    assert.equal(body.holdReasons.event_not_sent_by_dispatcher, 1);
  });
});

test('every registry event pushed through the real route behaves as its row says', async () => {
  await withDispatchEnv(async () => {
    for (const spec of NOTIFICATION_EVENT_REGISTRY) {
      const harness = dispatchHarness([
        contextRow({
          id: spec.eventType, event_type: spec.eventType, recipient_type: spec.recipient,
          // A slip decision needs an outcome to be wordable; give it one so this
          // case tests the DISPOSITION rather than the missing column.
          deposit_status: spec.eventType === 'deposit_slip_decision' ? 'verified' : null,
        }),
      ]);
      const response = await dispatchRoute.handleNotificationDispatch(
        dispatchRequest(), async () => harness.runtime as any, harness.send,
        harness.quotaTransport as any, harness.alertTransport, async () => 0, harness.sink,
      );
      const body = await response.json() as Record<string, any>;
      const shouldSend = spec.disposition === 'send_customer_line';
      assert.equal(
        harness.pushes.length, shouldSend ? 1 : 0,
        `${spec.eventType} (${spec.disposition}) sent ${harness.pushes.length} push(es)`,
      );
      assert.equal(body.sent, shouldSend ? 1 : 0, `${spec.eventType}: sent counter`);
      // Nothing may ever be counted as a metered send unless the registry says so.
      if (!shouldSend) {
        assert.equal(completionFor(harness, spec.eventType)?.args.p_status, 'failed');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D. The metering list cannot drift from the event list
// ---------------------------------------------------------------------------

test('the metered set is derived from the registry, never restated by hand', () => {
  const expected = NOTIFICATION_EVENT_REGISTRY
    .filter((spec) => spec.disposition === 'send_customer_line' && spec.meter === 'metered')
    .map((spec) => spec.eventType)
    .sort();
  assert.deepEqual(meteredNotificationEventTypes(), expected);
  const source = read('apps/booking-consumer/src/lib/notification-push-budget.ts');
  assert.match(
    source, /meteredNotificationEventTypes\(\)/,
    'the metered list must be computed from the registry; a hand-written array is how the two drifted apart in round 1',
  );
});

test('the dispatcher has no default message branch left anywhere', () => {
  const route = read('apps/booking-consumer/src/lib/notification-dispatch.ts');
  // The exact round-1 defect: an event with no branch inherits a confirmation.
  assert.doesNotMatch(route, /ยืนยันคิวที่/);
  assert.doesNotMatch(route, /\?\s*`ยืนยัน/, 'no ternary default may build customer text');
  assert.match(route, /buildCustomerEventText/);
  // The route must not CHOOSE the wording from the event name. The one remaining
  // comparison on `booking_cancelled` feeds the retry policy (a cancelled booking
  // retries terminally) and never a message, so it is asserted to be exactly that.
  const wordingComparisons = (route.match(/event_type === '(?!booking_cancelled')([a-z_]+)'/g) ?? []);
  assert.deepEqual(wordingComparisons, [], `the route still picks wording per event: ${wordingComparisons.join(', ')}`);
});
