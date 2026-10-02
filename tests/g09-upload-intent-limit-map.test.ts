/**
 * G09 — the SQL daily upload-intent ceiling must become a customer-facing refusal.
 *
 * THE NEW FACT (Codex, `supabase/bk01-migrations/20261002150000_bk01_p1_g09_g10.sql`).
 * `authorize_deposit_slip_upload` now keeps a per-booking success ledger in
 * `local_service_internal.booking_upload_intent_attempts` and, on the twenty-first
 * successful intent inside 24 hours, raises:
 *
 *     RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UPLOAD_INTENT_LIMIT';
 *
 * The app must turn that into a refusal the customer can act on ("ครบจำนวนครั้งที่
 * อัปโหลดสลิปได้แล้ว กรุณาติดต่อร้าน") instead of the generic "Invalid or expired
 * booking capability", which would tell an honest customer that their own token is bad.
 *
 * THE DISCRIMINATOR IS THE MESSAGE, NOT THE CODE. Every other refusal in this RPC —
 * including a wrong recovery token and the sixth wrong token inside the window — is
 * raised as `ERRCODE = 'P0001'` too ("Booking is not authorized for deposit upload",
 * "Invalid deposit upload input"). P0001 is shared, so the only reliable separator is
 * the exact message string. A substring match would be worse than useless here: the
 * two families of message differ by a suffix, so `includes` would classify the wrong
 * token as the daily ceiling. These cases pin the exact-match rule and prove the
 * wrong-token path is untouched.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = await import('../apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts');

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

/** The exact string the SQL raises, and the exact copy the customer must read. */
const SQL_DAILY_LIMIT_MESSAGE = 'UPLOAD_INTENT_LIMIT';
const DAILY_LIMIT_COPY_TH = 'ครบจำนวนครั้งที่อัปโหลดสลิปได้แล้ว กรุณาติดต่อร้าน';
/** What the SQL raises for a wrong token — and for the sixth wrong token in the window. */
const SQL_WRONG_TOKEN_MESSAGE = 'Booking is not authorized for deposit upload';

const read = (path: string) => readFileSync(path, 'utf8');
const json = (path: string) => JSON.parse(read(path)) as Record<string, never>;

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

function reset() {
  const resetFn = (route as Record<string, unknown>).resetUploadIntentRateLimit;
  if (typeof resetFn === 'function') (resetFn as () => void)();
}

/**
 * A runtime whose RPC answers with a chosen PostgREST-shaped error, like the real one.
 * `error: null` mints a grant instead (the honest path the daily ceiling must not alter).
 */
function runtimeHarness(error: { code?: string; message?: string } | null) {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    runtime: {
      rpc: async (name: string) => {
        rpcCalls.push(name);
        if (error) return { data: null, error };
        return { data: [{ object_path: `${BOOKING_ID}/1.png`, grant_id: 'grant-1' }], error: null };
      },
      storage: {
        from: () => ({
          createSignedUploadUrl: async (path: string) => ({ data: { token: `signed:${path}` }, error: null }),
        }),
      },
    },
  };
}

const DAILY_LIMIT_ERROR = { code: 'P0001', message: SQL_DAILY_LIMIT_MESSAGE };

test('the SQL daily ceiling is a 429 on its own scope, not a wrong-token 403', async () => {
  reset();
  const harness = runtimeHarness(DAILY_LIMIT_ERROR);
  const response = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);

  assert.equal(
    response.status,
    429,
    'the twenty-first successful intent is a quota refusal, not a bad token, so it must not be a 403',
  );
  const payload = await response.json() as { error?: string; code?: string; scope?: string };
  assert.equal(payload.scope, 'booking_daily', 'the daily ceiling is its own scope, apart from booking and source');
  assert.equal(payload.code, 'UPLOAD_INTENT_DAILY_LIMIT');
  assert.ok(Number(response.headers.get('retry-after')) > 0, 'a 429 without Retry-After is not actionable');
  assert.ok(
    Number(response.headers.get('retry-after')) <= 24 * 60 * 60,
    'the Retry-After must not exceed the 24-hour window the SQL counts inside',
  );
});

test('the daily refusal tells the customer to contact the shop, not to retry', async () => {
  reset();
  const harness = runtimeHarness(DAILY_LIMIT_ERROR);
  const response = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
  const payload = await response.json() as { error?: string };

  assert.equal(payload.error, DAILY_LIMIT_COPY_TH, 'the customer must read the approved Thai copy');
  assert.doesNotMatch(
    String(payload.error),
    /capability|ไม่ถูกต้อง|try again/i,
    'telling a holder with a good token that their capability is invalid is the defect this mapping removes',
  );
});

test('the response copy and the page catalogue are the same string, in both locales', () => {
  const errorsTh = (json('apps/booking-consumer/messages/th.json').booking as unknown as { errors: Record<string, string> }).errors;
  const errorsEn = (json('apps/booking-consumer/messages/en.json').booking as unknown as { errors: Record<string, string> }).errors;

  assert.equal(
    errorsTh.slipUploadDailyLimit,
    DAILY_LIMIT_COPY_TH,
    'the Thai catalogue must hold exactly the copy the API returns, so the two cannot drift',
  );
  assert.equal(typeof errorsEn.slipUploadDailyLimit, 'string', 'English customers read this refusal too');
  assert.ok(errorsEn.slipUploadDailyLimit.trim().length > 0);
  assert.doesNotMatch(errorsEn.slipUploadDailyLimit, /\d/, 'the copy states no number');
  assert.doesNotMatch(errorsEn.slipUploadDailyLimit, /capability|invalid token/i);
});

test('the page renders the localized refusal and the service maps the code to it', () => {
  const service = read('apps/booking-consumer/src/lib/booking-service.ts');
  const page = read('apps/booking-consumer/src/app/book/[slug]/page.tsx');

  assert.match(
    service,
    /UPLOAD_INTENT_DAILY_LIMIT/,
    'the service must recognise the daily-limit code rather than showing the raw server error',
  );
  assert.match(
    page,
    /errors\.slipUploadDailyLimit/,
    'the booking page must pass the localized copy, the way the other slip errors already do',
  );
});

test('a wrong recovery token is never reported as the daily ceiling', async () => {
  reset();
  const harness = runtimeHarness({ code: 'P0001', message: SQL_WRONG_TOKEN_MESSAGE });

  // Seven attempts: past the SQL invalid-token threshold of five, where the RPC also
  // refuses fast. The SQL uses the same raise for both, so none of them is the ceiling.
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
    assert.equal(response.status, 403, `wrong token attempt ${attempt + 1} must stay a 403`);
    const payload = await response.json() as { error?: string; code?: string; scope?: string };
    assert.notEqual(payload.code, 'UPLOAD_INTENT_DAILY_LIMIT');
    assert.notEqual(payload.scope, 'booking_daily');
    assert.notEqual(payload.error, DAILY_LIMIT_COPY_TH);
  }
});

test('only the exact message is the daily ceiling — never a near miss', async () => {
  // Exact match is the rule; a substring rule would make the wrong-token family and the
  // ceiling family collide. Each near miss must keep the generic refusal.
  for (const message of [
    'UPLOAD_INTENT_LIMIT_REACHED',
    'UPLOAD_INTENT_LIMITS',
    'NOT UPLOAD_INTENT_LIMIT',
    'upload_intent_limit',
    'Booking is not authorized for deposit upload',
  ]) {
    reset();
    const harness = runtimeHarness({ code: 'P0001', message });
    const response = await route.handleUploadIntent(request(body()), async () => harness.runtime as never);
    assert.equal(response.status, 403, `${message} must not be read as the daily ceiling`);
    const payload = await response.json() as { code?: string };
    assert.notEqual(payload.code, 'UPLOAD_INTENT_DAILY_LIMIT', `${message} must not be read as the daily ceiling`);
  }
});

test('every other RPC failure keeps the behaviour it had before this mapping', async () => {
  // 1. A malformed input raised by the same RPC.
  reset();
  const invalid = runtimeHarness({ code: 'P0001', message: 'Invalid deposit upload input' });
  const invalidResponse = await route.handleUploadIntent(request(body()), async () => invalid.runtime as never);
  assert.equal(invalidResponse.status, 403);
  assert.deepEqual(await invalidResponse.json(), { error: 'Invalid or expired booking capability' });

  // 2. An error object with no message at all.
  reset();
  const anonymous = runtimeHarness({});
  assert.equal((await route.handleUploadIntent(request(body()), async () => anonymous.runtime as never)).status, 403);

  // 3. A thrown transport failure is still the 503 it always was.
  reset();
  const response = await route.handleUploadIntent(request(body()), async () => {
    throw new Error('runtime unreachable');
  }) as Response;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Runtime upload authorization is unavailable' });

  // 4. The app's own window budgets are untouched: same codes, same scopes, same strings.
  reset();
  const honest = runtimeHarness(null);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await route.handleUploadIntent(request(body()), async () => honest.runtime as never)).status, 200);
  }
  const windowRefusal = await route.handleUploadIntent(request(body()), async () => honest.runtime as never);
  assert.equal(windowRefusal.status, 429);
  assert.deepEqual(await windowRefusal.json(), {
    error: 'Too many upload attempts for this booking. Please try again shortly.',
    code: 'UPLOAD_INTENT_RATE_LIMITED',
    scope: 'booking',
  });
});

test('the daily ceiling is the database authority — the app adds no second ceiling of its own', async () => {
  // The SQL counts 20 per 24 hours. The app's window budget is 5 per 15 minutes and is
  // refunded on every refusal, so a holder who is at the SQL ceiling can still present
  // a good token: the refusal is the database's, and the honest path stays reachable.
  reset();
  const atCeiling = runtimeHarness(DAILY_LIMIT_ERROR);
  const refusals = await Promise.all(
    Array.from({ length: 4 }, () =>
      route.handleUploadIntent(request(body()), async () => atCeiling.runtime as never)),
  );
  for (const refusal of refusals) {
    assert.equal(refusal.status, 429);
    assert.equal(atCeiling.rpcCalls.length, 4, 'each refusal must have been the database that decided');
  }

  reset();
  const underCeiling = runtimeHarness(null);
  let accepted = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await route.handleUploadIntent(request(body()), async () => underCeiling.runtime as never)).status === 200) accepted += 1;
  }
  assert.equal(accepted, 5, 'a booking under the SQL ceiling still gets its full window budget');
});
