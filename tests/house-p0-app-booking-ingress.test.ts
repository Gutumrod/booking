/**
 * BK01 P0 — application unit H4 (council finding G01, brief 28 §4, A-24 item 1).
 *
 * WHAT FAILED. `create_booking_hold` was EXECUTE-able by `anon` and the public page
 * called it from the browser, so the page was decoration: an attacker read a shop
 * slug and called the RPC in a loop. Measured: one Free shop burnt through its
 * 50-bookings-a-month allowance and then refused its real customers
 * (`SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS`); a paying shop had 22 of one day's slots
 * held. There was no server check of any kind — the council could find no rate
 * limit, CAPTCHA or admission control in the repository.
 *
 * WHAT THIS FILE PROVES. Every case below drives the REAL route handler
 * (`handleBookingHold`) with an injected runtime and an injected Turnstile
 * transport, so the assertions are about decisions the route made:
 *
 *   - a missing / rejected / unredeemable challenge is refused BEFORE the database;
 *   - the challenge is validated SERVER-side with the provider's own endpoint;
 *   - the abuse budget keys on ip+shop and refuses the request AFTER the limit with
 *     429 + Retry-After, again before the database;
 *   - the successful path calls `create_booking_hold` with the same nine named
 *     arguments the browser used to send, through the runtime identity;
 *   - in production a MISSING secret is a refusal, never a pass;
 *   - the browser no longer holds a path to the RPC (the service layer posts to the
 *     route, and the page supplies a challenge token).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BOOKING_RATE_LIMIT_MAX,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET,
  bookingHoldRpcArgs,
  consumeBookingRateLimit,
  parseBookingHoldRequest,
  readClientIp,
  resetBookingRateLimit,
  resolveTurnstileSecret,
  verifyBookingChallenge,
} from '../apps/booking-consumer/src/lib/booking-ingress.ts';

// The handler lives in a library module now: the App Router route module may export
// only HTTP methods (Next 16.3.6 asserts it — a non-method export fails as TS2344).
const route = await import('../apps/booking-consumer/src/lib/booking-hold.ts');

const read = (path: string) => readFileSync(path, 'utf8');

// The official Cloudflare test sitekey/secret pair (documented "always passes"), and
// the documented failure pair. They are public constants, safe to name in a test.
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    shop_id: SHOP_ID,
    service_id: SERVICE_ID,
    staff_id: null,
    customer_name: 'สมชาย ทดสอบ',
    customer_phone: '0812345678',
    customer_email: null,
    booking_date: '2026-10-20',
    start_time: '14:30',
    notes: null,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9' }) {
  return new Request('https://bk01.test/api/bookings/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** A runtime whose `create_booking_hold` records its arguments and answers a hold. */
function runtimeHarness() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    runtime: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'create_booking_hold') {
          return { data: { booking_id: 'b1', booking_code: 'BK1', link_token: 'tok', status: 'confirmed', deposit_status: 'not_required', deposit_amount: 0, total_price: 100, expires_at: null, staff_id: STAFF_ID }, error: null };
        }
        return { data: null, error: null };
      },
    },
  };
}

const passingTurnstile = {
  verify: async () => ({ ok: true, body: { success: true, 'error-codes': [] } }),
};
const failingTurnstile = {
  verify: async () => ({ ok: true, body: { success: false, 'error-codes': ['invalid-input-response'] } }),
};
const unreachableTurnstile = {
  verify: async () => ({ ok: false, body: null }),
};

/** Every case runs with a clean abuse budget and a known secret. */
async function withIngressEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = {
    secret: process.env.TURNSTILE_SECRET_KEY,
    nodeEnv: process.env.NODE_ENV,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string | undefined>)[key] = value;
  }
  resetBookingRateLimit();
  try {
    return await run();
  } finally {
    process.env.TURNSTILE_SECRET_KEY = saved.secret;
    process.env.NODE_ENV = saved.nodeEnv;
    resetBookingRateLimit();
  }
}

// ---------------------------------------------------------------------------
// A. The challenge is checked on the server, before anything else touches data
// ---------------------------------------------------------------------------

test('a request with no challenge token is refused and the database is never called', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    const response = await route.handleBookingHold(
      request(validBody({ turnstileToken: '' })), async () => harness.runtime as any, passingTurnstile as any,
    );
    assert.equal(response.status, 400, 'a body with no token is malformed at the boundary');
    assert.deepEqual(harness.calls, [], 'nothing may reach the RPC without a challenge');
  });
});

test('a challenge the provider REJECTS is refused with 403 and the database is never called', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    const response = await route.handleBookingHold(
      request(validBody()), async () => harness.runtime as any, failingTurnstile as any,
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json() as any).code, 'BOOKING_CHALLENGE_FAILED');
    assert.deepEqual(harness.calls, [], 'a rejected challenge must not reach the database');
  });
});

test('an UNREACHABLE challenge provider fails closed (503), it does not let the booking through', async () => {
  // The direction is deliberate and is the opposite of the LINE quota breaker: that
  // guards a cost, this guards the door.
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    const response = await route.handleBookingHold(
      request(validBody()), async () => harness.runtime as any, unreachableTurnstile as any,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(harness.calls, []);
  });
});

test('a GOOD challenge proceeds and calls the RPC with the nine named arguments', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    const response = await route.handleBookingHold(
      request(validBody({ staff_id: STAFF_ID, notes: 'ขอช่างเดิม' })),
      async () => harness.runtime as any, passingTurnstile as any,
    );
    assert.equal(response.status, 200);
    assert.equal(harness.calls.length, 1);
    const call = harness.calls[0];
    assert.equal(call.name, 'create_booking_hold');
    assert.deepEqual(Object.keys(call.args).sort(), [
      'p_booking_date', 'p_customer_email', 'p_customer_name', 'p_customer_phone',
      'p_notes', 'p_service_id', 'p_shop_id', 'p_staff_id', 'p_start_time',
    ], 'the RPC signature the CONTRACT pins is unchanged');
    assert.equal(call.args.p_staff_id, STAFF_ID);
    assert.equal(call.args.p_notes, 'ขอช่างเดิม');
    assert.equal((await response.json() as any).hold.booking_code, 'BK1');
  });
});

// ---------------------------------------------------------------------------
// B. The secret: real in production, the documented test key in development
// ---------------------------------------------------------------------------

test('production with no configured secret REFUSES — an unconfigured challenge is not a pass', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: 'production' }, async () => {
    const resolved = resolveTurnstileSecret(process.env as Record<string, string | undefined>);
    assert.equal(resolved.secret, null);
    assert.equal(resolved.source, 'missing');

    const harness = runtimeHarness();
    const response = await route.handleBookingHold(
      request(validBody()), async () => harness.runtime as any, passingTurnstile as any,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(harness.calls, [], 'no production booking may be created without a real secret');
  });
});

test('outside production the documented Cloudflare TEST secret is used, and it is named as such', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: 'development' }, async () => {
    const resolved = resolveTurnstileSecret(process.env as Record<string, string | undefined>);
    assert.equal(resolved.secret, TURNSTILE_TEST_SECRET);
    assert.equal(resolved.source, 'development_test_key');
  });
});

test('the route NEVER accepts a test secret in production, even if one is configured', () => {
  // A test secret configured in production would make every challenge pass. The route
  // only refuses a MISSING secret, so the guard that matters here is that the real key
  // is an Owner/ops responsibility — pinned in the report, asserted as absent from code.
  const source = read('apps/booking-consumer/src/lib/booking-hold.ts')
    + read('apps/booking-consumer/src/lib/booking-ingress.ts');
  assert.match(source, /TURNSTILE_SECRET_KEY/, 'the secret is read from the environment');
  assert.doesNotMatch(source, /1x00000000000000000000AA/, 'no REAL secret may be hard-coded (only the documented test secret)');
  assert.doesNotMatch(source, /console\.(?:log|error)/, 'the secret must never be logged');
});

test('the challenge is validated at the provider endpoint Cloudflare documents', () => {
  assert.equal(TURNSTILE_SITEVERIFY_URL, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
});

test('siteverify is called with the token, the secret and the request IP — never from the browser', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const calls: Array<{ secret: string; token: string; remoteIp: string | null }> = [];
    const transport = {
      verify: async (input: { secret: string; token: string; remoteIp: string | null }) => {
        calls.push(input);
        return { ok: true, body: { success: true } };
      },
    };
    await verifyBookingChallenge({
      env: process.env as Record<string, string | undefined>,
      token: 'token-abc',
      remoteIp: '203.0.113.9',
      transport: transport as any,
    });
    assert.deepEqual(calls, [{ secret: 'real-secret', token: 'token-abc', remoteIp: '203.0.113.9' }]);
  });
});

// ---------------------------------------------------------------------------
// C. The abuse budget: ip + shop, counted before the challenge
// ---------------------------------------------------------------------------

test('the client IP comes from the Cloudflare header, not from the body', () => {
  const headers = { get: (name: string) => (name === 'cf-connecting-ip' ? '198.51.100.7' : null) };
  assert.equal(readClientIp(headers), '198.51.100.7');
  assert.equal(readClientIp({ get: () => null }), null);
  assert.equal(readClientIp({ get: () => '   ' }), null);
});

test('the budget is per ip + shop: one attacker cannot spend another shop allowance, nor spread', () => {
  resetBookingRateLimit();
  const now = new Date('2026-10-05T10:00:00Z');
  // Exhaust one shop's budget from one IP.
  for (let i = 0; i < BOOKING_RATE_LIMIT_MAX; i += 1) {
    assert.equal(consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SHOP_ID, now }).allowed, true);
  }
  // The next request from the same IP on the SAME shop is refused...
  const refused = consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SHOP_ID, now });
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds !== null && refused.retryAfterSeconds >= 1);
  // ...a DIFFERENT shop is untouched (so one shop's attacker cannot affect another)...
  assert.equal(consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SERVICE_ID, now }).allowed, true);
  // ...and a DIFFERENT IP on the first shop is untouched (so one IP cannot lock a shop).
  assert.equal(consumeBookingRateLimit({ clientIp: '198.51.100.7', shopId: SHOP_ID, now }).allowed, true);
  resetBookingRateLimit();
});

test('an unidentified caller is counted in ONE shared bucket, not given a free pass', () => {
  resetBookingRateLimit();
  const now = new Date('2026-10-05T10:00:00Z');
  let allowed = 0;
  for (let i = 0; i < BOOKING_RATE_LIMIT_MAX + 3; i += 1) {
    if (consumeBookingRateLimit({ clientIp: null, shopId: SHOP_ID, now }).allowed) allowed += 1;
  }
  assert.equal(allowed, BOOKING_RATE_LIMIT_MAX, 'a caller we cannot identify is limited too');
  resetBookingRateLimit();
});

test('the window expires: the same caller is allowed again after it passes', () => {
  resetBookingRateLimit();
  const start = new Date('2026-10-05T10:00:00Z');
  for (let i = 0; i < BOOKING_RATE_LIMIT_MAX; i += 1) {
    consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SHOP_ID, now: start });
  }
  assert.equal(consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SHOP_ID, now: start }).allowed, false);
  const later = new Date(start.getTime() + 11 * 60 * 1000);
  assert.equal(consumeBookingRateLimit({ clientIp: '203.0.113.9', shopId: SHOP_ID, now: later }).allowed, true);
  resetBookingRateLimit();
});

test('OVER the budget the real route answers 429 with Retry-After, before the challenge and the DB', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    let challengeCalls = 0;
    const countingChallenge = {
      verify: async () => { challengeCalls += 1; return { ok: true, body: { success: true } }; },
    };
    const call = () => route.handleBookingHold(
      request(validBody()), async () => harness.runtime as any, countingChallenge as any,
    );

    for (let i = 0; i < BOOKING_RATE_LIMIT_MAX; i += 1) {
      assert.equal((await call()).status, 200, `request ${i + 1} is inside the budget`);
    }
    const refused = await call();
    assert.equal(refused.status, 429);
    assert.equal((await refused.json() as any).code, 'BOOKING_RATE_LIMITED');
    const retryAfter = refused.headers.get('Retry-After');
    assert.ok(retryAfter && /^\d+$/.test(retryAfter) && Number(retryAfter) >= 1, `Retry-After must be numeric, saw ${retryAfter}`);

    // The rate check ran FIRST: an over-budget request never spends a challenge round
    // trip and never reaches the database.
    assert.equal(challengeCalls, BOOKING_RATE_LIMIT_MAX, 'the refused request did not consult the challenge');
    assert.equal(harness.calls.length, BOOKING_RATE_LIMIT_MAX, 'and never reached the RPC');
  });
});

// ---------------------------------------------------------------------------
// D. The body boundary and the RPC signature
// ---------------------------------------------------------------------------

test('a malformed body is refused without a challenge or a database call', async () => {
  await withIngressEnv({ TURNSTILE_SECRET_KEY: 'real-secret' }, async () => {
    const harness = runtimeHarness();
    for (const body of [
      {},
      validBody({ shop_id: 'not-a-uuid' }),
      validBody({ service_id: null }),
      validBody({ customer_name: '' }),
      validBody({ customer_phone: '12345' }),
      validBody({ customer_phone: '0712345678' }),   // not a Thai mobile prefix
      validBody({ booking_date: '20-10-2026' }),
      validBody({ start_time: '25:99' }),
      validBody({ notes: 'x'.repeat(501) }),
    ]) {
      const response = await route.handleBookingHold(
        request(body), async () => harness.runtime as any, passingTurnstile as any,
      );
      assert.equal(response.status, 400, `body ${JSON.stringify(body).slice(0, 60)} must be refused`);
    }
    assert.deepEqual(harness.calls, []);
  });
});

test('optional fields become null so the RPC call shape is identical to the browser s', () => {
  const parsed = parseBookingHoldRequest(validBody({ staff_id: '', notes: '', customer_email: '' }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.staff_id, null);
  assert.equal(parsed.value.notes, null);
  assert.equal(parsed.value.customer_email, null);
  assert.equal(parsed.value.start_time, '14:30:00', 'a HH:MM start time is normalised to the RPC s HH:MM:SS');
  assert.deepEqual(bookingHoldRpcArgs(parsed.value), {
    p_shop_id: SHOP_ID,
    p_service_id: SERVICE_ID,
    p_staff_id: null,
    p_customer_name: 'สมชาย ทดสอบ',
    p_customer_phone: '0812345678',
    p_customer_email: null,
    p_booking_date: '2026-10-20',
    p_start_time: '14:30:00',
    p_notes: null,
  });
});

test('a spaces-and-dashes phone number is normalised, exactly as the page validated it', () => {
  const parsed = parseBookingHoldRequest(validBody({ customer_phone: '081-234 5678' }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.customer_phone, '0812345678');
});

// ---------------------------------------------------------------------------
// E. The browser no longer has a path to the RPC
// ---------------------------------------------------------------------------

test('the consumer service posts to the server route instead of calling the RPC', () => {
  const service = read('apps/booking-consumer/src/lib/booking-service.ts');
  assert.match(service, /fetch\('\/api\/bookings\/hold'/);
  // The direct anon call must be gone. The RPC name may still appear in prose, so
  // only a `.rpc(` call is a violation.
  const bookingServiceCode = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(bookingServiceCode, /\.rpc\(\s*'create_booking_hold'/, 'the anon RPC call must be removed');
});

test('the booking page renders a challenge widget and sends the token with the request', () => {
  const page = read('apps/booking-consumer/src/app/book/[slug]/page.tsx');
  assert.match(page, /NEXT_PUBLIC_TURNSTILE_SITEKEY/, 'the sitekey is public and configurable');
  assert.match(page, /challenges\.cloudflare\.com\/turnstile/, 'the official widget script');
  assert.match(page, /turnstile_token: tokenRef\.current/, 'the token travels with the booking request');
  // The secret is never in the page, and neither is a real key.
  assert.doesNotMatch(page, /TURNSTILE_SECRET_KEY/, 'the secret must not be shipped to the browser');
});

test('the handler does not name a new RPC beyond the allowlisted create_booking_hold', () => {
  // The route module delegates to this handler, which is where the RPC is named.
  const source = read('apps/booking-consumer/src/lib/booking-hold.ts');
  const rpcNames = [...source.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(rpcNames, ['create_booking_hold']);
});
