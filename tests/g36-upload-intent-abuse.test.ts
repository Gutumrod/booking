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

/** A runtime that mints a fresh grant every time, like the real RPC does. */
function runtimeHarness() {
  const rpcCalls: string[] = [];
  let minted = 0;
  return {
    rpcCalls,
    get minted() { return minted; },
    runtime: {
      rpc: async (name: string) => {
        rpcCalls.push(name);
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
  // 20 distinct source addresses, 5 grants each: the per-source budget alone would
  // allow 100 grants against one booking. A per-booking ceiling must stop it.
  for (let source = 0; source < 20; source += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await route.handleUploadIntent(
        request(body(), `198.51.100.${source + 1}`),
        async () => harness.runtime as never,
      );
      if (response.status === 200) accepted += 1;
    }
  }
  assert.ok(accepted <= 20, `a booking accepted ${accepted} grants from 20 different addresses`);
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
