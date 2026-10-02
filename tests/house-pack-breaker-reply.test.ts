import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CENTRAL_OA_CONSUMPTION_URL,
  CENTRAL_OA_QUOTA_URL,
  OA_QUOTA_BREAKER_THRESHOLD,
  bangkokDayKey,
  breakerMutesPlan,
  providerAlertIdempotencyKey,
  pushAlertDedupeKey,
  readCentralOaQuota,
  resolveBreakerDecision,
  sendOpsAlert,
  type QuotaTransport,
} from '../apps/booking-consumer/src/lib/notification-oa-breaker.ts';
import { createResendOpsAlertTransport } from '../apps/booking-consumer/src/lib/notification-dispatch.ts';

/**
 * Unit 7 items 3 + 4 — the shared-OA quota breaker and the binding reply.
 *
 * Item 3: when the ONE shared OA is over 80% consumed for the month, Free shops
 * stop being pushed and Basic/trial keep going; the Owner is told through
 * `OPS_ALERT_EMAIL`, with no fallback channel.
 *
 * The endpoint names below are the ones LINE's official reference documents
 * (`GET /v2/bot/message/quota` and `.../quota/consumption`). They are verified
 * against the reference, not guessed, and the test pins them so a future edit
 * cannot quietly point the breaker at a URL that does not exist.
 *
 * What is proven here: the decision and the transport contract with a fake
 * transport. What is NOT: a real read against LINE (there is no credential).
 */

const read = (path: string) => readFileSync(path, 'utf8');

/**
 * A lowercase shop UUID — the ONLY shop segment the F1/F2 migration accepts
 * (`push_cap_unverified:<lowercase UUID>:<day>`). A readable slug like `shop-1`
 * is a key SQL rejects, so the cap path is exercised with a real-shaped id.
 */
const SHOP_UUID = '3f1e2d4c-0000-4000-8000-000000000001';

/** The key of a successful `pushAlertDedupeKey` result, asserted `ok` first. */
function alertKey(input: { kind: 'cap_unverified' | 'quota_unreadable' | 'breaker_open'; shopId?: string; at: Date }): string {
  const result = pushAlertDedupeKey(input);
  assert.equal(result.ok, true, `pushAlertDedupeKey refused ${input.kind}`);
  return result.ok ? result.key : '';
}

function fakeTransport(pages: Record<string, { ok: boolean; status: number; body: unknown }>): {
  transport: QuotaTransport;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    transport: {
      async getJson(url) {
        calls.push(url);
        return pages[url] ?? { ok: false, status: 404, body: null };
      },
    },
  };
}

test('the quota endpoints are the ones LINE documents', () => {
  assert.equal(CENTRAL_OA_QUOTA_URL, 'https://api.line.me/v2/bot/message/quota');
  assert.equal(CENTRAL_OA_CONSUMPTION_URL, 'https://api.line.me/v2/bot/message/quota/consumption');
  assert.equal(OA_QUOTA_BREAKER_THRESHOLD, 0.8);
});

test('over 80% of the month opens the breaker, at or under it stays closed', () => {
  assert.equal(resolveBreakerDecision({ status: 'read', limit: 1000, used: 800 }).state, 'closed');
  assert.equal(resolveBreakerDecision({ status: 'read', limit: 1000, used: 801 }).state, 'open');
  const at81 = resolveBreakerDecision({ status: 'read', limit: 1000, used: 810 });
  assert.equal(at81.state, 'open');
  assert.equal(at81.openedBy, 'quota_exceeded');
  assert.ok(at81.ratio !== null && Math.abs(at81.ratio - 0.81) < 1e-9);
});

test('an unmeasurable quota leaves the breaker CLOSED, and says why', () => {
  // The direction is deliberate and opposite to the per-send decisions: a quota we
  // cannot read must not mute every shop's notifications.
  for (const read_ of [
    { status: 'not_configured' as const, limit: null, used: null },
    { status: 'unavailable' as const, limit: null, used: null },
    { status: 'unlimited' as const, limit: null, used: null },
  ]) {
    const decision = resolveBreakerDecision(read_);
    assert.equal(decision.state, 'closed');
    assert.equal(decision.ratio, null);
    assert.equal(decision.openedBy, 'quota_unmeasurable');
  }
});

test('the breaker mutes Free shops only — Basic, trial and Pro keep sending', () => {
  assert.equal(breakerMutesPlan('free'), true);
  assert.equal(breakerMutesPlan('basic_490'), false);
  assert.equal(breakerMutesPlan('pro_990'), false);
  assert.equal(breakerMutesPlan('what'), false);
});

test('the quota read calls both endpoints and never throws on a bad response', async () => {
  const happy = fakeTransport({
    [CENTRAL_OA_QUOTA_URL]: { ok: true, status: 200, body: { type: 'limited', value: 15000 } },
    [CENTRAL_OA_CONSUMPTION_URL]: { ok: true, status: 200, body: { totalUsage: 12000 } },
  });
  const result = await readCentralOaQuota({ accessToken: 'token', transport: happy.transport });
  assert.deepEqual(result, { status: 'read', limit: 15000, used: 12000 });
  assert.deepEqual(happy.calls, [CENTRAL_OA_QUOTA_URL, CENTRAL_OA_CONSUMPTION_URL]);

  const noToken = await readCentralOaQuota({ accessToken: '', transport: happy.transport });
  assert.equal(noToken.status, 'not_configured');

  const broken = fakeTransport({
    [CENTRAL_OA_QUOTA_URL]: { ok: false, status: 500, body: null },
  });
  assert.equal((await readCentralOaQuota({ accessToken: 'token', transport: broken.transport })).status, 'unavailable');

  const wrongShape = fakeTransport({
    [CENTRAL_OA_QUOTA_URL]: { ok: true, status: 200, body: { unexpected: true } },
  });
  assert.equal((await readCentralOaQuota({ accessToken: 'token', transport: wrongShape.transport })).status, 'unavailable');

  // A plan with no monthly limit has no percentage to exceed.
  const unlimited = fakeTransport({
    [CENTRAL_OA_QUOTA_URL]: { ok: true, status: 200, body: { type: 'none' } },
  });
  assert.equal((await readCentralOaQuota({ accessToken: 'token', transport: unlimited.transport })).status, 'unlimited');
});

test('an over-quota read combined with a free shop is what the route pauses', async () => {
  const overQuota = fakeTransport({
    [CENTRAL_OA_QUOTA_URL]: { ok: true, status: 200, body: { type: 'limited', value: 300 } },
    [CENTRAL_OA_CONSUMPTION_URL]: { ok: true, status: 200, body: { totalUsage: 260 } },
  });
  const measured = await readCentralOaQuota({ accessToken: 'token', transport: overQuota.transport });
  assert.equal(resolveBreakerDecision(measured).state, 'open');
  assert.equal(breakerMutesPlan('free'), true);
  assert.equal(breakerMutesPlan('basic_490'), false);

  const route = read('apps/booking-consumer/src/lib/notification-dispatch.ts');
  assert.match(route, /breakerMutesPlan/);
  assert.match(route, /oa_quota_breaker_free_shop/);
  assert.match(route, /OPS_ALERT_EMAIL|sendOpsAlert/);
});

test('the alert day key is the Thai day, not the UTC one, and carries the F1/F2 shape', () => {
  // 2026-10-02T00:00+07:00 is 2026-10-01T17:00Z — already the 2nd in Bangkok.
  assert.equal(bangkokDayKey(new Date('2026-10-01T16:59:59Z')), '2026-10-01');
  assert.equal(bangkokDayKey(new Date('2026-10-01T17:00:00Z')), '2026-10-02');
  const day = bangkokDayKey(new Date('2026-10-01T06:00:00Z'));
  const at = new Date('2026-10-01T06:00:00Z');

  // CONTRACT-BK01-P0-SQL-2026-10-02.md "Opencode R1 review follow-up — F1/F2", on
  // top of migration 20261002140000_bk01_review_f1_f2.sql:
  //   system kinds carry the literal `global` segment (they are facts about the
  //   ONE central OA, not about any shop);
  //   the cap kind carries a LOWERCASE shops.id UUID.
  assert.deepEqual(pushAlertDedupeKey({ kind: 'breaker_open', at }), { ok: true, key: `breaker_open:global:${day}` });
  assert.deepEqual(pushAlertDedupeKey({ kind: 'quota_unreadable', at }), { ok: true, key: `quota_unreadable:global:${day}` });
  assert.deepEqual(
    pushAlertDedupeKey({ kind: 'cap_unverified', shopId: SHOP_UUID, at }),
    { ok: true, key: `push_cap_unverified:${SHOP_UUID}:${day}` },
  );
  // A UUID spelled in upper case is normalised: SQL's regex accepts lowercase only.
  assert.deepEqual(
    pushAlertDedupeKey({ kind: 'cap_unverified', shopId: SHOP_UUID.toUpperCase(), at }),
    { ok: true, key: `push_cap_unverified:${SHOP_UUID}:${day}` },
  );

  // The old shape (`breaker_open:<day>`) and the old dash fallback are keys this
  // migration REJECTS, so they must not be emittable any more.
  assert.notEqual(alertKey({ kind: 'breaker_open', at }), `breaker_open:${day}`);
  assert.doesNotMatch(alertKey({ kind: 'cap_unverified', shopId: SHOP_UUID, at }), /-:/);

  // A cap alert that cannot name a valid shop UUID is a REFUSAL, not a fallback:
  // no key is produced, so the caller records no alert rather than a failed one.
  assert.deepEqual(pushAlertDedupeKey({ kind: 'cap_unverified', at }), { ok: false, reason: 'shop_id_required' });
  assert.deepEqual(pushAlertDedupeKey({ kind: 'cap_unverified', shopId: '   ', at }), { ok: false, reason: 'shop_id_required' });
  for (const bad of ['-', 'shop-1', 'not-a-uuid', '3f1e2d4c-0000-4000-8000-00000000000']) {
    assert.deepEqual(
      pushAlertDedupeKey({ kind: 'cap_unverified', shopId: bad, at }),
      { ok: false, reason: 'shop_id_invalid' },
      `${bad} is not a shop UUID`,
    );
  }
});

// ---------------------------------------------------------------------------
// The two-phase claim / acknowledge contract (PART A)
// ---------------------------------------------------------------------------

test('an alert is SENT only when the claim returned claimed=true', async () => {
  const sent: Array<{ to: string }> = [];
  const transport = { async send(input: { to: string }) { sent.push(input); return { ok: true, status: 200 }; } };
  const { sink } = dayLedger();
  const key = alertKey({ kind: 'breaker_open', at: new Date('2026-10-01T06:00:00Z') });
  const env = { OPS_ALERT_EMAIL: 'owner@example.com' };

  const first = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey: key });
  // The key is now delivered, so a later claim comes back false and NO send may
  // follow it.
  const unclaimed = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey: key });
  assert.equal(first.sent, true);
  assert.equal(unclaimed.sent, false);
  assert.equal(sent.length, 1, 'no send without a authorising claim');
});

test('a send that reports failure or throws is NOT acknowledged, so the key stays retryable', async () => {
  const env = { OPS_ALERT_EMAIL: 'owner@example.com' };
  const key = alertKey({ kind: 'breaker_open', at: new Date('2026-10-01T06:00:00Z') });

  // (a) the provider rejects the message.
  {
    const ledger = dayLedger();
    const failed = { async send() { return { ok: false, status: 500, error: 'nope' }; } };
    const result = await sendOpsAlert({ env, subject: 's', text: 't', transport: failed, sink: ledger.sink, kind: 'breaker_open', dedupeKey: key });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'transport_unavailable');
    assert.equal(ledger.delivered.size, 0, 'a failed send must not be acknowledged');
    assert.equal(ledger.calls.at(-1)?.delivered, false, 'the last ledger call was a claim, not an acknowledgement');
  }

  // (b) the transport throws.
  {
    const ledger = dayLedger();
    const throwing = { async send(): Promise<{ ok: boolean; status: number }> { throw new Error('boom'); } };
    const result = await sendOpsAlert({ env, subject: 's', text: 't', transport: throwing, sink: ledger.sink, kind: 'breaker_open', dedupeKey: key });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'transport_unavailable');
    assert.equal(ledger.delivered.size, 0, 'a thrown send must not be acknowledged');
  }
});

test('a claimed-and-acknowledged alert is never sent twice, and the acknowledgement never authorises another send', async () => {
  const sent: Array<unknown> = [];
  const transport = { async send(input: unknown) { sent.push(input); return { ok: true, status: 200 }; } };
  const ledger = dayLedger();
  const env = { OPS_ALERT_EMAIL: 'owner@example.com' };
  const key = alertKey({ kind: 'cap_unverified', shopId: SHOP_UUID, at: new Date('2026-10-01T06:00:00Z') });

  const one = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink: ledger.sink, kind: 'cap_unverified', dedupeKey: key });
  assert.equal(one.sent, true);

  // The acknowledgement itself: `sendOpsAlert` acknowledges with delivered=true.
  assert.ok(ledger.delivered.has(key), 'the alert was acknowledged after the provider accepted it');
  const acknowledgements = ledger.calls.filter((call) => call.delivered === true);
  assert.equal(acknowledgements.length, 1, 'exactly one acknowledgement is written');
  assert.equal(ledger.calls.filter((call) => call.delivered === false).length, 1, 'exactly one claim is made');

  // A second attempt that finds the acknowledgement returns claimed=false, so no
  // second mail can leave.
  const two = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink: ledger.sink, kind: 'cap_unverified', dedupeKey: key });
  assert.equal(two.sent, false);
  assert.equal(sent.length, 1, 'never sent twice for one key');
});

test('the provider idempotency key is stable for a (kind, day key) pair and is sent as the header', async () => {
  const at = new Date('2026-10-01T06:00:00Z');
  const key = alertKey({ kind: 'breaker_open', at });
  // Derived from the kind and the key ALONE — the same inputs give the same string.
  assert.equal(providerAlertIdempotencyKey('breaker_open', key), `breaker_open:${key}`);
  assert.equal(
    providerAlertIdempotencyKey('breaker_open', key),
    providerAlertIdempotencyKey('breaker_open', alertKey({ kind: 'breaker_open', at })),
  );

  // The Resend transport carries it to the provider as the real header, defined ONCE.
  const route = read('apps/booking-consumer/src/lib/notification-dispatch.ts');
  assert.match(route, /export const RESEND_IDEMPOTENCY_HEADER = 'Idempotency-Key';/);
  assert.match(route, /\[RESEND_IDEMPOTENCY_HEADER\]: idempotencyKey/);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input: any, init: any) => {
    calls.push({ url: String(input), init });
    return new Response('{}', { status: 200 });
  };
  const transport = createResendOpsAlertTransport(
    { RESEND_API_KEY: 'k', OPS_ALERT_FROM: 'ops@example.com' },
    fakeFetch,
  );
  const result = await transport.send({ to: 'owner@example.com', subject: 's', text: 't', idempotencyKey: providerAlertIdempotencyKey('breaker_open', key) });
  assert.equal(result.ok, true);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], `breaker_open:${key}`, 'the stable key is the real header');
});

test('the Resend transport is FAIL-CLOSED with no API key and never reports success', async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => { called = true; return new Response('{}', { status: 200 }); };

  const noKey = await createResendOpsAlertTransport({ OPS_ALERT_FROM: 'ops@example.com' }, fakeFetch)
    .send({ to: 'o@example.com', subject: 's', text: 't', idempotencyKey: 'k' });
  assert.equal(noKey.ok, false, 'no API key must never report success');

  const noFrom = await createResendOpsAlertTransport({ RESEND_API_KEY: 'k' }, fakeFetch)
    .send({ to: 'o@example.com', subject: 's', text: 't', idempotencyKey: 'k' });
  assert.equal(noFrom.ok, false);

  const noTo = await createResendOpsAlertTransport({ RESEND_API_KEY: 'k', OPS_ALERT_FROM: 'ops@example.com' }, fakeFetch)
    .send({ to: '', subject: 's', text: 't', idempotencyKey: 'k' });
  assert.equal(noTo.ok, false);

  assert.equal(called, false, 'an unconfigured transport makes no outbound call at all');
});

/**
 * A ledger that behaves like the SQL contract's two phases: an undelivered claim
 * leases the key (and returns `claimed: true`), and an ACKNOWLEDGEMENT
 * (`delivered: true`) records it delivered and NEVER authorises another send.
 * `dayLedger` returns the sink plus the calls it saw, so a test can tell a claim
 * apart from an acknowledgement.
 */
function dayLedger() {
  const claimed = new Set<string>();
  const delivered = new Set<string>();
  const calls: Array<{ kind: string; key: string; delivered: boolean }> = [];
  return {
    claimed,
    delivered,
    calls,
    sink: {
      async claim({ kind, key, delivered: acknowledged }: { kind: string; key: string; delivered: boolean }) {
        calls.push({ kind, key, delivered: acknowledged });
        if (acknowledged) {
          // An acknowledgement only lands on a key already claimed, and it never
          // authorises a send.
          delivered.add(key);
          return { claimed: false, delivered: true };
        }
        if (claimed.has(key) || delivered.has(key)) return { claimed: false, delivered: delivered.has(key) };
        claimed.add(key);
        return { claimed: true, delivered: false };
      },
    },
  };
}

test('the Owner alert is fail-closed: no address means no alert and no side channel', async () => {
  const sent: Array<{ to: string }> = [];
  const transport = { async send(input: { to: string }) { sent.push(input); return { ok: true, status: 200 }; } };
  const { sink } = dayLedger();
  const dedupeKey = alertKey({ kind: 'breaker_open', at: new Date('2026-10-01T06:00:00Z') });

  const noAddress = await sendOpsAlert({
    env: {}, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey,
  });
  assert.deepEqual(noAddress, { sent: false, reason: 'not_configured', to: null, dedupeKey: null });
  assert.deepEqual(sent, [], 'nothing may be sent anywhere without OPS_ALERT_EMAIL');

  const withAddress = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey,
  });
  assert.equal(withAddress.sent, true);
  assert.equal(withAddress.dedupeKey, dedupeKey);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');

  const noTransport = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport: null, sink, kind: 'breaker_open', dedupeKey,
  });
  assert.equal(noTransport.sent, false);
  assert.equal(noTransport.reason, 'transport_unavailable');
  assert.equal(sent.length, 1);

  // No ledger ⇒ the once-per-day limit cannot be honoured ⇒ fail closed.
  const noSink = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport, sink: null, kind: 'breaker_open', dedupeKey,
  });
  assert.equal(noSink.sent, false);
  assert.equal(sent.length, 1, 'an unlimited alert burst is never the fallback');
});

test('the Owner alert is limited to once per key per Thai day', async () => {
  const sent: Array<{ to: string }> = [];
  const transport = { async send(input: { to: string }) { sent.push(input); return { ok: true, status: 200 }; } };
  const { sink } = dayLedger();
  const env = { OPS_ALERT_EMAIL: 'owner@example.com' };
  const at = new Date('2026-10-01T06:00:00Z');
  const today = alertKey({ kind: 'breaker_open', at });
  const tomorrow = alertKey({ kind: 'breaker_open', at: new Date(at.getTime() + 24 * 60 * 60 * 1000) });
  assert.notEqual(today, tomorrow);

  const first = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey: today });
  const repeat = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey: today });
  const nextDay = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, kind: 'breaker_open', dedupeKey: tomorrow });

  assert.equal(first.sent, true);
  assert.equal(repeat.sent, false);
  assert.equal(repeat.reason, 'already_alerted_today', 'a second call on the same day is suppressed');
  assert.equal(nextDay.sent, true, 'the day rolls over and the alert may fire again');
  assert.equal(sent.length, 2);
});

// ---------------------------------------------------------------------------
// Item 4 — the binding reply
// ---------------------------------------------------------------------------

test('the binding reply already exists and now fails soft on an expired reply token', () => {
  const source = read('apps/booking-consumer/src/lib/line-webhook.ts');
  // The customer is still confirmed even when the courtesy reply cannot be sent.
  assert.match(source, /REPLY_NOT_DELIVERED/);
  assert.match(source, /catch \(replyError\)/);
  // The reply lives inside its own try, before the delivery is finalized as processed.
  const replyIndex = source.indexOf('catch (replyError)');
  const finalizeIndex = source.indexOf("p_status: 'processed'");
  assert.ok(replyIndex >= 0 && finalizeIndex > replyIndex, 'the reply must be attempted before the event is finalized');
  // The binding itself is still finalized as processed, not as a failure.
  assert.doesNotMatch(source, /p_status: deliverySucceeded \? 'processed' : 'failed'/);
  // The card carries the code and the 3-hour promise.
  assert.match(source, /createBookingLinkBoundFlexCard/);
});
