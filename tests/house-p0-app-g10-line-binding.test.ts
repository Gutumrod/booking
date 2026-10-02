/**
 * BK01 P1 — G10 (council finding G10; contract
 * `06-Agent-Logs/WSTERA-House/briefs/CONTRACT-BK01-G09-G10-2026-10-02.md`, section G10).
 *
 * TWO PROPERTIES, PROVEN BY BEHAVIOUR:
 *
 *  A. A REFUSED BINDING FAILS CLOSED WITH NEUTRAL COPY. `handleLineWebhook` used to
 *     reply ONLY when the binding RPC answered `claimed=true`. When the RPC refused
 *     — a wrong/expired token, a replayed webhook event, a cross-shop attempt, or a
 *     CONFLICT where the target customer or LINE id is already bound to another
 *     customer in the same shop — the handler silently skipped and the customer was
 *     told nothing. The fix sends EXACTLY ONE neutral text message that names nobody,
 *     reveals nothing about whether the booking exists, and tells the customer to
 *     contact the shop. It is fail-soft like the existing card reply: a reply failure
 *     must not fail the event, must not change the RPC sequence, and must not leave
 *     the event leased.
 *
 *  B. TENANT-SCOPED RECIPIENT, NO PHONE IDENTITY. The dispatcher must resolve every
 *     recipient from THAT row's OWN delivery context in the same tenant, and the
 *     binding path must pass no phone-shaped argument and must reach data only
 *     through the allowlisted runtime RPCs (never a direct table read).
 *
 * RED-FIRST: every neutral-reply assertion below is RED against the pre-fix source
 * (the handler sent nothing on `claimed=false`) and GREEN after the fix. The
 * cross-row recipient property is already held by the current source (it resolves
 * `p_id: claim.id` per row); the mutation harness entry
 * `p0-g10-recipient-takes-the-first-row` proves that property is NOT vacuous.
 *
 * The `.from(` scan ignores `Buffer.from(...)`: that is the crypto buffer used to
 * verify the webhook signature, not a table read, and it is the only `.from(` in
 * either module. Every other `.from(` would be a direct Supabase table read.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lineRoute = await import('../apps/booking-consumer/src/lib/line-webhook.ts');
const dispatchRoute = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');

const read = (path: string) => readFileSync(path, 'utf8');

/** The exact copy the Owner order pins for a refused binding. */
const EXACT_THAI = 'ไม่สามารถผูกบัญชีนี้ได้ กรุณาติดต่อร้าน';
const EXACT_EN = 'This account cannot be linked. Please contact the shop.';

/** A real lowercase shop UUID, matching the shape the alert keys accept. */
const SHOP_UUID = '3f1e2d4c-0000-4000-8000-000000000001';
const LINE_A = `U${'a'.repeat(32)}`;
const LINE_B = `U${'b'.repeat(32)}`;

const LINE_SECRET = 'line-secret';
const LINE_TOKEN = 'line-access';

function request(path: string, body: string, headers: Record<string, string> = {}) {
  return new Request(`https://bk01.test${path}`, { method: 'POST', headers, body });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

/** A local HMAC helper, so the test does not depend on the module under test. */
function sign(body: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

const merchantConfig = { mode: 'merchant' as const, channelSecret: LINE_SECRET, accessToken: LINE_TOKEN };
const centralConfig = { mode: 'central' as const, channelSecret: LINE_SECRET, accessToken: LINE_TOKEN };
const event = {
  type: 'message',
  webhookEventId: 'line-event-g10-1',
  replyToken: 'reply-token-g10',
  source: { userId: LINE_A },
  message: { type: 'text', text: 'ผูกคิว BK1234-ABCD123456' },
};

function refusedRuntime(rpcName: string) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === rpcName) {
        return {
          data: [{ claimed: false, booking_id: null, shop_id: null, customer_id: null, line_user_id: null, booking_context: null, lease_token: null }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  return { runtime, calls };
}

function recordingSend() {
  const replies: Array<{ url: string; body: any }> = [];
  const send = (async (url: any, init: any) => {
    replies.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { send, replies };
}

// ---------------------------------------------------------------------------
// A. The catalogue carries the refused-binding copy verbatim (parity)
// ---------------------------------------------------------------------------

test('G10 the refused-binding copy is present verbatim in both consumer catalogues', () => {
  const th = JSON.parse(read('apps/booking-consumer/messages/th.json'));
  const en = JSON.parse(read('apps/booking-consumer/messages/en.json'));
  assert.equal(th.lineBinding?.refused, EXACT_THAI, 'th.json must carry the exact Thai copy');
  assert.equal(en.lineBinding?.refused, EXACT_EN, 'en.json must carry the exact English copy');
  // Identical key path in both files, so the i18n parity test holds and neither
  // locale can drift alone.
  assert.deepEqual(Object.keys(th.lineBinding).sort(), Object.keys(en.lineBinding).sort());
});

// ---------------------------------------------------------------------------
// A. A refused binding sends exactly one neutral reply
// ---------------------------------------------------------------------------

test('G10 a refused merchant binding sends exactly one neutral reply and nothing else', async () => {
  const body = JSON.stringify({ events: [event] });
  const { runtime, calls } = refusedRuntime('bk01_line_bind_booking');
  const { send, replies } = recordingSend();

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    merchantConfig, 'shop-1', async () => runtime as any, send,
  );
  const result = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(result.skippedEvents, 1, 'a refused binding stays a skip, not a failure');
  assert.equal(result.failedEvents, 0, 'a refused binding must not fail the webhook event');

  // EXACTLY ONE neutral text message, addressed to this event's reply token.
  assert.equal(replies.length, 1, 'exactly one reply leaves for a refused binding');
  assert.match(replies[0].url, /\/v2\/bot\/message\/reply$/);
  assert.equal(replies[0].body.replyToken, event.replyToken);
  assert.equal(replies[0].body.messages.length, 1, 'one text message, not a burst');
  assert.equal(replies[0].body.messages[0].type, 'text');

  const text = String(replies[0].body.messages[0].text);
  assert.ok(text.includes(EXACT_THAI), 'the neutral reply must contain the exact Thai sentence');
  assert.ok(text.includes(EXACT_EN), 'and its English pair (L-01)');
  // It names nobody and leaks nothing about the booking.
  assert.ok(!text.includes('BK1234'), 'must not reveal the booking code');
  assert.ok(!text.includes(event.message.text), 'must not echo the customer command');
  assert.ok(!text.includes(LINE_A), 'must not name any LINE id');
  assert.ok(!text.includes('ร้านทดสอบ'), 'must not name a shop');

  // The RPC sequence is UNCHANGED: only the refused bind ran — no finish call, so
  // nothing is added to or renamed in the allowlist, and no lease is left behind.
  assert.deepEqual(calls.map((call) => call.name), ['bk01_line_bind_booking']);
});

test('G10 a refused CENTRAL binding also sends the neutral reply on the trial path', async () => {
  const body = JSON.stringify({ events: [event] });
  const { runtime, calls } = refusedRuntime('bk01_line_bind_booking_trial');
  const { send, replies } = recordingSend();

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    centralConfig, undefined, async () => runtime as any, send,
  );
  const result = await responseJson(response);

  assert.equal(result.skippedEvents, 1);
  assert.equal(replies.length, 1);
  assert.ok(String(replies[0].body.messages[0].text).includes(EXACT_THAI));
  assert.deepEqual(calls.map((call) => call.name), ['bk01_line_bind_booking_trial']);
});

// ---------------------------------------------------------------------------
// A. No reply without a reply token, without an access token, or without scope
// ---------------------------------------------------------------------------

test('G10 no neutral reply is attempted when the refused event has NO reply token', async () => {
  const noToken = { ...event, replyToken: undefined };
  const body = JSON.stringify({ events: [noToken] });
  const { runtime, calls } = refusedRuntime('bk01_line_bind_booking');
  const { send, replies } = recordingSend();

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    merchantConfig, 'shop-1', async () => runtime as any, send,
  );
  const result = await responseJson(response);

  assert.equal(result.skippedEvents, 1);
  assert.equal(replies.length, 0, 'no reply token ⇒ no neutral reply');
  assert.equal(result.failedEvents, 0, 'and the absence of a reply token is not a failure');
  assert.deepEqual(calls.map((call) => call.name), ['bk01_line_bind_booking']);
});

test('G10 no neutral reply is attempted when NO access token is configured', async () => {
  const body = JSON.stringify({ events: [event] });
  const { runtime, calls } = refusedRuntime('bk01_line_bind_booking');
  const { send, replies } = recordingSend();

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    { mode: 'merchant' as const, channelSecret: LINE_SECRET, accessToken: '' },
    'shop-1', async () => runtime as any, send,
  );
  const result = await responseJson(response);

  assert.equal(result.skippedEvents, 1);
  assert.equal(replies.length, 0, 'no access token ⇒ no outbound call at all');
  assert.deepEqual(calls.map((call) => call.name), ['bk01_line_bind_booking']);
});

test('G10 a reply TRANSPORT failure on a refusal is swallowed: no failure, no extra RPC', async () => {
  const body = JSON.stringify({ events: [event] });
  const { runtime, calls } = refusedRuntime('bk01_line_bind_booking');
  const replySend = (async () => { throw new Error('LINE unreachable'); }) as unknown as typeof fetch;

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    merchantConfig, 'shop-1', async () => runtime as any, replySend,
  );
  const result = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(result.failedEvents, 0, 'a failed neutral reply must not fail the event');
  assert.equal(result.skippedEvents, 1);
  assert.deepEqual(calls.map((call) => call.name), ['bk01_line_bind_booking'], 'the RPC sequence is untouched');
});

test('G10 the merchant path with no trusted shop scope still returns 503 before any RPC and sends nothing', async () => {
  const body = JSON.stringify({ events: [event] });
  let providerCalls = 0;
  let sends = 0;

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    merchantConfig, undefined,
    async () => { providerCalls += 1; return { rpc: async () => ({ data: [{ claimed: false }], error: null }) } as any; },
    (async () => { sends += 1; return new Response('{}', { status: 200 }); }) as typeof fetch,
  );

  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0, 'the runtime is never acquired without a trusted shop scope');
  assert.equal(sends, 0, 'and nothing is sent');
});

// ---------------------------------------------------------------------------
// A. The successful path is unchanged (no regression)
// ---------------------------------------------------------------------------

test('G10 a successful binding still sends the flex card and finishes the delivery', async () => {
  const body = JSON.stringify({ events: [event] });
  const names: string[] = [];
  const runtime = {
    rpc: async (name: string) => {
      names.push(name);
      if (name === 'bk01_line_bind_booking') {
        return {
          data: [{
            claimed: true, booking_id: 'b1', shop_id: 's1', customer_id: 'c1', line_user_id: LINE_A,
            booking_context: { booking_code: 'BK-1234', booking_date: '2026-10-01', start_time: '09:00', shop_name: 'ร้านทดสอบ' },
            lease_token: 'lease-1',
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  const { send, replies } = recordingSend();

  const response = await lineRoute.handleLineWebhook(
    request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
    merchantConfig, 'shop-1', async () => runtime as any, send,
  );
  const result = await responseJson(response);

  assert.equal(result.processedEvents, 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].body.messages[0].type, 'flex', 'the confirmation is the card, not the refusal text');
  assert.ok(!JSON.stringify(replies[0]).includes(EXACT_THAI));
  assert.deepEqual(names, ['bk01_line_bind_booking', 'bk01_finish_line_webhook_delivery']);
});

// ---------------------------------------------------------------------------
// B. The binding path passes NO phone-shaped argument, in either mode
// ---------------------------------------------------------------------------

test('G10 the binding RPC is called with no phone-shaped argument in either mode', async () => {
  const cases = [
    { mode: 'central' as const, rpc: 'bk01_line_bind_booking_trial', shop: undefined,
      keys: ['p_webhook_event_id', 'p_booking_code', 'p_link_token', 'p_line_user_id'] },
    { mode: 'merchant' as const, rpc: 'bk01_line_bind_booking', shop: 'shop-1',
      keys: ['p_webhook_event_id', 'p_booking_code', 'p_link_token', 'p_expected_shop_id', 'p_line_user_id'] },
  ];
  const body = JSON.stringify({ events: [event] });

  for (const scenario of cases) {
    const captured: Array<{ name: string; keys: string[] }> = [];
    const runtime = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        captured.push({ name, keys: Object.keys(args) });
        if (name === scenario.rpc) {
          return {
            data: [{
              claimed: true, booking_id: 'b1', shop_id: 's1', customer_id: 'c1', line_user_id: LINE_A,
              booking_context: { booking_code: 'BK-1234', booking_date: '2026-10-01', start_time: '09:00', shop_name: 'ร้านทดสอบ' },
              lease_token: 'lease-1',
            }],
            error: null,
          };
        }
        return { data: true, error: null };
      },
    };
    const { send } = recordingSend();

    await lineRoute.handleLineWebhook(
      request('/line', body, { 'x-line-signature': sign(body, LINE_SECRET) }),
      { mode: scenario.mode, channelSecret: LINE_SECRET, accessToken: LINE_TOKEN },
      scenario.shop as any, async () => runtime as any, send,
    );

    const bind = captured.find((call) => call.name === scenario.rpc);
    assert.ok(bind, `${scenario.mode}: the bind RPC ran`);
    for (const key of bind!.keys) {
      assert.doesNotMatch(key, /phone/i, `${scenario.mode}: argument ${key} is phone-shaped`);
    }
    assert.deepEqual(bind!.keys.sort(), [...scenario.keys].sort(), `${scenario.mode}: the argument keys are exactly these`);
  }
});

// ---------------------------------------------------------------------------
// B. Tenant-scoped recipient: every claimed row resolves its OWN context
// ---------------------------------------------------------------------------

function recipientHarness() {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const pushes: Array<Record<string, any>> = [];
  const contexts: Record<string, Record<string, unknown>> = {
    'row-a': {
      id: 'row-a', shop_id: SHOP_UUID, event_type: 'booking_cancelled', recipient_type: 'customer',
      attempt_count: 1, line_user_id: LINE_A, line_oa_id: null, shop_name: 'ร้านเอ',
      subscription_plan: 'free', booking_date: '2026-10-05', start_time: '14:30:00',
    },
    'row-b': {
      id: 'row-b', shop_id: SHOP_UUID, event_type: 'booking_cancelled', recipient_type: 'customer',
      attempt_count: 1, line_user_id: LINE_B, line_oa_id: null, shop_name: 'ร้านบี',
      subscription_plan: 'free', booking_date: '2026-10-05', start_time: '15:30:00',
    },
  };
  const runtime = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        // TWO claimed rows of the SAME shop, whose delivery contexts carry DIFFERENT
        // `line_user_id` values.
        return { data: [
          { id: 'row-a', shop_id: SHOP_UUID, event_type: 'booking_cancelled', attempt_count: 1 },
          { id: 'row-b', shop_id: SHOP_UUID, event_type: 'booking_cancelled', attempt_count: 1 },
        ], error: null };
      }
      if (name === 'get_line_notification_delivery_context') {
        // Returns the context for the row the caller ACTUALLY asked for. A caller
        // that asks for the wrong id gets the wrong context, which is the defect the
        // mutation harness reproduces.
        return { data: [contexts[String(args.p_id)]], error: null };
      }
      return { data: true, error: null };
    },
  };
  const send = (async (url: any, init: any) => {
    if (String(url).includes('/v2/bot/message/push')) pushes.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { runtime, send, rpcCalls, pushes };
}

const READABLE_QUOTA = { getJson: async (url: string) => url.endsWith('/consumption')
  ? { ok: true, status: 200, body: { totalUsage: 10 } }
  : { ok: true, status: 200, body: { type: 'limited', value: 300 } } };

const DISPATCH_REQUEST = () => new Request('https://bk01.test/dispatch', {
  method: 'POST', headers: { authorization: 'Bearer dispatch-secret' }, body: '',
});

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

test('G10 each claimed row resolves its OWN delivery context and pushes to its OWN line id', async () => {
  await withDispatchEnv(async () => {
    const harness = recipientHarness();
    const response = await dispatchRoute.handleNotificationDispatch(
      DISPATCH_REQUEST(),
      async () => harness.runtime as any,
      harness.send,
      READABLE_QUOTA as any,
      { send: async () => ({ ok: true, status: 200 }) },
      undefined,
      { claim: async () => ({ claimed: true, delivered: false }) },
    );
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.sent, 2, 'both rows are sent');

    // (i) `get_line_notification_delivery_context` is called ONCE PER CLAIMED ROW,
    //     with `p_id` equal to THAT row's own id.
    const contextCalls = harness.rpcCalls.filter((call) => call.name === 'get_line_notification_delivery_context');
    assert.equal(contextCalls.length, 2, 'one context read per claimed row');
    assert.deepEqual(contextCalls.map((call) => call.args.p_id), ['row-a', 'row-b']);

    // (ii) each LINE push is addressed to that row's OWN `line_user_id`.
    assert.equal(harness.pushes.length, 2);
    const tos = harness.pushes.map((push) => push.to);
    assert.deepEqual([...tos].sort(), [LINE_A, LINE_B].sort(), 'each row pushes to its own LINE id');

    // (iii) no push crosses to the OTHER row's LINE id: exactly one push per id.
    assert.equal(tos.filter((to) => to === LINE_A).length, 1, 'exactly one push to row-a');
    assert.equal(tos.filter((to) => to === LINE_B).length, 1, 'exactly one push to row-b');

    // The text each row receives carries THAT row's own shop, never the other's —
    // the visible proof that the recipient was not borrowed from the sibling row.
    const pushA = harness.pushes.find((push) => push.to === LINE_A)!;
    const pushB = harness.pushes.find((push) => push.to === LINE_B)!;
    assert.ok(String(pushA.messages[0].text).includes('ร้านเอ'), 'row-a gets row-a context');
    assert.ok(String(pushB.messages[0].text).includes('ร้านบี'), 'row-b gets row-b context');
    assert.ok(!String(pushB.messages[0].text).includes('ร้านเอ'), 'row-b must never carry row-a context');

    // Both rows belong to ONE tenant: no cross-shop lookup happened.
    const contextShopIds = [contextCalls[0].args.p_id, contextCalls[1].args.p_id];
    assert.deepEqual(contextShopIds, ['row-a', 'row-b']);
  });
});

// ---------------------------------------------------------------------------
// B. Neither module reads a table directly
// ---------------------------------------------------------------------------

test('G10 the webhook and the dispatcher reach data only through runtime RPCs, never a table', () => {
  for (const path of [
    'apps/booking-consumer/src/lib/line-webhook.ts',
    'apps/booking-consumer/src/lib/notification-dispatch.ts',
  ]) {
    const raw = read(path);
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE_KEY|getSupabaseAdmin/, `${path} must not use a service-role client`);

    // Every `.from(` in these modules must be the crypto `Buffer.from(...)`; any
    // other `.from(` would be a direct Supabase table read.
    const allFrom = (code.match(/\.from\s*\(/g) ?? []).length;
    const bufferFrom = (code.match(/Buffer\s*\.\s*from\s*\(/g) ?? []).length;
    assert.equal(allFrom, bufferFrom, `${path}: the only .from( calls are Buffer.from(...) — no table read`);

    // Data is reached through the allowlisted runtime RPC surface.
    assert.match(code, /\.rpc\s*\(/, `${path} must reach data through runtime RPCs`);
  }
});
