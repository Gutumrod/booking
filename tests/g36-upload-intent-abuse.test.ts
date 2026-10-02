/**
 * G36 reproduction — `POST /api/deposit-slips/upload-intent` has no admission
 * control of its own (council-holes-2026-10-01, section 2, AGY F-13).
 *
 * THE CLAIM. Anyone holding a booking's `link_token` while the hold is live can
 * POST the intent endpoint as often as they like. Each accepted request registers
 * one object path and returns one signed upload URL, so the holder can authorise an
 * unbounded number of 5 MB uploads against a single booking.
 *
 * WHY THE EXISTING GUARD DOES NOT COVER IT. The RPC does call
 * `authorize_booking_recovery_attempt`, but that counter only increments on a
 * FAILED token (`supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql:55-60`,
 * which counts `failed_attempts` and blocks at 5). A correct token DELETEs its
 * counter row and returns true, so a holder who owns the token never touches the
 * limiter — the limiter defends the token, not the endpoint.
 *
 * These cases drive the REAL handler with an injected runtime, so the assertions are
 * about decisions the route made. Before the fix the first case fails: the handler
 * has no counter at all and every request reaches the RPC.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const route = await import('../apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts');

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOKING_ID = '22222222-2222-4222-8222-222222222222';
/** A booking id with hex letters: case and hyphen changes are visible on it. */
const LETTERED_BOOKING_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function body(bookingId = BOOKING_ID) {
  return { bookingId, recoveryToken: 'RECOVERY-TOKEN', contentType: 'image/png', size: 2048 };
}

function request(payload: unknown, ip: string | null = '203.0.113.9') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ip) headers['cf-connecting-ip'] = ip;
  return new Request('https://bk01.test/api/deposit-slips/upload-intent', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

/**
 * A runtime that mints a fresh grant every time, like the real RPC does.
 * `validToken: false` models a caller who knows the booking id but not the token:
 * the RPC refuses and mints nothing — the case the booking budget must not punish.
 */
function runtimeHarness({ validToken = true }: { validToken?: boolean } = {}) {
  const rpcCalls: string[] = [];
  let minted = 0;
  return {
    rpcCalls,
    get minted() { return minted; },
    runtime: {
      rpc: async (name: string) => {
        rpcCalls.push(name);
        if (!validToken) return { data: null, error: { message: 'invalid_capability' } };
        minted += 1;
        return { data: [{ object_path: `${BOOKING_ID}/${minted}.png`, grant_id: `grant-${minted}` }], error: null };
      },
      storage: {
        from: () => ({
          createSignedUploadUrl: async (path: string) => ({ data: { token: `signed:${path}` }, error: null }),
        }),
      },
    },
  };
}

function reset() {
  const resetFn = (route as Record<string, unknown>).resetUploadIntentRateLimit;
  if (typeof resetFn === 'function') (resetFn as () => void)();
}

test('one live token cannot mint an unbounded number of upload grants for one booking', async () => {
  reset();
  const harness = runtimeHarness();
  let accepted = 0;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
    if (response.status === 200) accepted += 1;
  }

  assert.ok(accepted < 25, `25 consecutive intent requests from one holder were all accepted (${accepted}/25)`);
  assert.equal(accepted, 5, `expected the documented per-booking budget of 5 grants, got ${accepted}`);
  assert.equal(harness.minted, accepted, 'the refused requests must not reach the RPC');
});

test('the refusal is a 429 that tells the caller to retry, and it never reaches the database', async () => {
  reset();
  const harness = runtimeHarness();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
  }

  const refused = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
  assert.equal(refused.status, 429);
  assert.equal((await refused.json() as { code?: string }).code, 'UPLOAD_INTENT_RATE_LIMITED');
  assert.ok(Number(refused.headers.get('retry-after')) > 0, 'a 429 without Retry-After is not actionable');
  assert.equal(harness.rpcCalls.length, 5, 'the refused request must stop before the runtime');
});

test('the budget is per booking, so a second booking is unaffected', async () => {
  reset();
  const harness = runtimeHarness();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
  }
  assert.equal((await route.handleUploadIntent(request(body()), async () => harness.runtime as never)).status, 429);

  const otherBooking = await route.handleUploadIntent(request(body(OTHER_BOOKING_ID)), async () => harness.runtime as never);
  assert.equal(otherBooking.status, 200, 'a different booking has its own budget');
});

test('a booking is also capped in absolute terms, so many source addresses cannot add up without limit', async () => {
  reset();
  const harness = runtimeHarness();
  let accepted = 0;
  // 20 distinct source addresses, 5 attempts each: the per-source budget is never
  // reached (5 of 20), so the per-booking ceiling is the only thing that can stop
  // this. Asserting `<= 20` would have passed while the cap was 4x too loose — the
  // ceiling under test is 5, so the assertion is 5.
  for (let source = 0; source < 20; source += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await route.handleUploadIntent(
        request(body(), `198.51.100.${source + 1}`),
        async () => harness.runtime as never,
      );
      if (response.status === 200) accepted += 1;
    }
  }
  assert.equal(accepted, 5, `a booking accepted ${accepted} grants from 20 different addresses, not its budget of 5`);
});

test('a caller with no identifiable address is limited, not given a free pass', async () => {
  reset();
  const harness = runtimeHarness();
  let accepted = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await route.handleUploadIntent(request(body(), null), async () => harness.runtime as never);
    if (response.status === 200) accepted += 1;
  }
  assert.equal(accepted, 5, 'an unrecognised caller shares one bucket and is capped too');
});

/*
 * The case above never actually exercises the per-source budget: hammering a single
 * booking id hits the per-booking cap of 5 first, and the source bucket is never
 * consulted. Walking one booking per request isolates the source bucket — and for
 * that ceiling to exist at all, an unrecognised caller must land in ONE shared
 * bucket. A bucket derived per request would make the cap unreachable, which is
 * exactly the mutation this case is here to catch.
 */
test('an unrecognised caller walking many bookings shares one source bucket and still hits the ceiling', async () => {
  reset();
  const harness = runtimeHarness();
  let accepted = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const bookingId = `33333333-3333-4333-8333-${String(attempt).padStart(12, '0')}`;
    const response = await route.handleUploadIntent(request(body(bookingId), null), async () => harness.runtime as never);
    if (response.status === 200) accepted += 1;
  }
  assert.equal(
    accepted,
    20,
    `an unidentifiable caller minted ${accepted} grants across distinct bookings, so the shared source ceiling of 20 did not hold`,
  );
  assert.equal(harness.rpcCalls.length, 20, 'the refused requests must not reach the runtime');
});

/*
 * F1 (opencode + AGY, HIGH). The budget keyed on the RAW `bookingId` string, while
 * the RPC's parameter is a Postgres `uuid`, which accepts several spellings of the
 * same value. One booking therefore had a bucket per spelling, and the ceiling was
 * a property of the spelling rather than of the booking. The first case here refuses
 * every non-canonical spelling; the second measures the ceiling across spellings and
 * demands exactly 5, which the loose `<= 20` assertion could never catch.
 */
test('a booking id that is not the canonical uuid form is refused before the budget and the runtime', async () => {
  reset();
  const harness = runtimeHarness();
  const nonCanonical = [
    LETTERED_BOOKING_ID.replace(/-/g, ''),          // no hyphens — Postgres accepts it
    LETTERED_BOOKING_ID.toUpperCase(),              // upper case — Postgres accepts it
    `{${LETTERED_BOOKING_ID}}`,                     // brace form — Postgres accepts it
    ` ${LETTERED_BOOKING_ID}`,                      // leading space
    `${LETTERED_BOOKING_ID} `,                      // trailing space
    '3f2504e0-4f89-41d3-9a0c-0305e82c330',          // truncated by one hex digit
    '',                                             // empty
  ];
  for (const shape of nonCanonical) {
    const response = await route.handleUploadIntent(request(body(shape)), async () => harness.runtime as never);
    assert.equal(response.status, 400, `booking id ${JSON.stringify(shape)} was not refused as malformed (HTTP ${response.status})`);
  }
  assert.equal(harness.rpcCalls.length, 0, 'a malformed booking id must be refused before the budget and the runtime');
});

test('the per-booking ceiling is 5 whatever spelling the caller starts with', async () => {
  reset();
  const harness = runtimeHarness();
  const spellings = [LETTERED_BOOKING_ID, LETTERED_BOOKING_ID.replace(/-/g, ''), LETTERED_BOOKING_ID.toUpperCase(), `{${LETTERED_BOOKING_ID}}`];
  let accepted = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await route.handleUploadIntent(
      request(body(spellings[attempt % spellings.length])),
      async () => harness.runtime as never,
    );
    if (response.status === 200) accepted += 1;
  }
  assert.equal(accepted, 5, `one booking accepted ${accepted} grants across re-spellings of its own id, not its budget of 5`);
  assert.equal(harness.rpcCalls.length, 5, 'nothing but the accepted requests may reach the runtime');
});

/*
 * F4 (opencode, LOW). Spending the per-booking budget BEFORE the token is verified
 * let anyone who merely knows a booking id (it is in the customer's own URL) burn
 * the real customer's five attempts and lock them out for the window. The booking
 * budget is therefore only charged when a valid token produced a grant; the source
 * budget is still charged on every attempt, so an attacker gains nothing net.
 */
test('a caller who knows only the booking id cannot lock the real customer out', async () => {
  reset();
  const impostor = runtimeHarness({ validToken: false });
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await route.handleUploadIntent(request(body()), async () => impostor.runtime as never);
    assert.equal(response.status, 403, 'a wrong token is refused on its own merits');
  }
  assert.equal(impostor.minted, 0, 'a refused token must not mint a grant');

  const genuine = runtimeHarness();
  let accepted = 0;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await route.handleUploadIntent(request(body()), async () => genuine.runtime as never);
    if (response.status === 200) accepted += 1;
  }
  assert.equal(accepted, 5, `the real customer got ${accepted} of their 5 grants after a stranger spent the booking budget`);
});

/*
    * F5 (opencode, LOW). The single 429 text blamed the booking even when the source
    * ceiling was what refused. A caller cannot act on a message that names the wrong
    * layer, so the refusal carries the layer that refused it.
    */
test('the 429 names the layer that refused it', async () => {
  reset();
  const byBooking = runtimeHarness();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await route.handleUploadIntent(request(body(), '203.0.113.10'), async () => byBooking.runtime as never);
  }
  const bookingRefusal = await route.handleUploadIntent(request(body(), '203.0.113.10'), async () => byBooking.runtime as never);
  assert.equal(bookingRefusal.status, 429);
  const bookingBody = await bookingRefusal.json() as { scope?: string };
  assert.equal(bookingBody.scope, 'booking', 'the refusal must name the booking layer');
  assert.match(bookingBody.scope ?? '', /booking/);

  reset();
  const bySource = runtimeHarness();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bookingId = `44444444-4444-4444-8444-${String(attempt).padStart(12, '0')}`;
    const response = await route.handleUploadIntent(request(body(bookingId), '203.0.113.11'), async () => bySource.runtime as never);
    assert.equal(response.status, 200, 'each distinct booking has its own booking budget');
  }
  const fifthBooking = `44444444-4444-4444-8444-${String(99).padStart(12, '0')}`;
  const sourceRefusal = await route.handleUploadIntent(request(body(fifthBooking), '203.0.113.11'), async () => bySource.runtime as never);
  assert.equal(sourceRefusal.status, 429);
  const sourceBody = await sourceRefusal.json() as { scope?: string; error?: string };
  assert.equal(sourceBody.scope, 'source', 'the refusal must name the source layer, not the booking');
  assert.match(String(sourceBody.error), /address|network|source/i);
});
