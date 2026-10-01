import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CENTRAL_OA_CONSUMPTION_URL,
  CENTRAL_OA_QUOTA_URL,
  OA_QUOTA_BREAKER_THRESHOLD,
  bangkokDayKey,
  breakerMutesPlan,
  pushAlertDedupeKey,
  readCentralOaQuota,
  resolveBreakerDecision,
  sendOpsAlert,
  type QuotaTransport,
} from '../apps/booking-consumer/src/lib/notification-oa-breaker.ts';

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

  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.match(route, /breakerMutesPlan/);
  assert.match(route, /oa_quota_breaker_free_shop/);
  assert.match(route, /OPS_ALERT_EMAIL|sendOpsAlert/);
});

test('the alert day key is the Thai day, not the UTC one', () => {
  // 2026-10-02T00:00+07:00 is 2026-10-01T17:00Z — already the 2nd in Bangkok.
  assert.equal(bangkokDayKey(new Date('2026-10-01T16:59:59Z')), '2026-10-01');
  assert.equal(bangkokDayKey(new Date('2026-10-01T17:00:00Z')), '2026-10-02');
  const day = bangkokDayKey(new Date('2026-10-01T06:00:00Z'));
  assert.equal(pushAlertDedupeKey({ kind: 'breaker_open', at: new Date('2026-10-01T06:00:00Z') }), `oa_breaker_open:${day}`);
  assert.equal(
    pushAlertDedupeKey({ kind: 'cap_unverified', shopId: 'shop-1', at: new Date('2026-10-01T06:00:00Z') }),
    `push_cap_unverified:shop-1:${day}`,
  );
});

function dayLedger() {
  const seen = new Set<string>();
  return {
    seen,
    sink: {
      async claim({ dedupeKey }: { dedupeKey: string }) {
        if (seen.has(dedupeKey)) return { claimed: false };
        seen.add(dedupeKey);
        return { claimed: true };
      },
    },
  };
}

test('the Owner alert is fail-closed: no address means no alert and no side channel', async () => {
  const sent: Array<{ to: string }> = [];
  const transport = { async send(input: { to: string }) { sent.push(input); return { ok: true, status: 200 }; } };
  const { sink } = dayLedger();
  const dedupeKey = pushAlertDedupeKey({ kind: 'breaker_open', at: new Date('2026-10-01T06:00:00Z') });

  const noAddress = await sendOpsAlert({
    env: {}, subject: 's', text: 't', transport, sink, dedupeKey,
  });
  assert.deepEqual(noAddress, { sent: false, reason: 'not_configured', to: null, dedupeKey: null });
  assert.deepEqual(sent, [], 'nothing may be sent anywhere without OPS_ALERT_EMAIL');

  const withAddress = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport, sink, dedupeKey,
  });
  assert.equal(withAddress.sent, true);
  assert.equal(withAddress.dedupeKey, dedupeKey);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');

  const noTransport = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport: null, sink, dedupeKey,
  });
  assert.equal(noTransport.sent, false);
  assert.equal(noTransport.reason, 'transport_unavailable');
  assert.equal(sent.length, 1);

  // No ledger ⇒ the once-per-day limit cannot be honoured ⇒ fail closed.
  const noSink = await sendOpsAlert({
    env: { OPS_ALERT_EMAIL: 'owner@example.com' }, subject: 's', text: 't', transport, sink: null, dedupeKey,
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
  const today = pushAlertDedupeKey({ kind: 'breaker_open', at });
  const tomorrow = pushAlertDedupeKey({ kind: 'breaker_open', at: new Date(at.getTime() + 24 * 60 * 60 * 1000) });
  assert.notEqual(today, tomorrow);

  const first = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, dedupeKey: today });
  const repeat = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, dedupeKey: today });
  const nextDay = await sendOpsAlert({ env, subject: 's', text: 't', transport, sink, dedupeKey: tomorrow });

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
  const source = read('apps/booking-consumer/src/app/api/line/webhook/route.ts');
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
