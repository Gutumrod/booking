import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMerchantEmail } from '../apps/booking-consumer/src/lib/notification-email.ts';
import {
  createResendTransport,
  isMerchantEmailConfigured,
  readMerchantEmailConfig,
  EMAIL_NOT_CONFIGURED,
} from '../apps/booking-consumer/src/lib/notification-email-transport.ts';
import {
  isMerchantEmailEvent,
  resolveNotificationChannel,
} from '../apps/booking-consumer/src/lib/notification-channel.ts';

/**
 * Owner decision A-20: the shop is told about a slip by the admin badge and by
 * e-mail, never by LINE, and the e-mail carries the least it can. These tests are
 * the guard on both halves of that sentence.
 */

const FORBIDDEN_IN_BODY = [
  /@/, // an e-mail address or a handle that looks like one
  /0\d[\d\s-]{7,}/, // a Thai mobile number in any spacing
  /฿/,
  /\bTHB\b/i,
  /\bamount\b/i,
  /\bยอด\b/,
  /\bสลิป\b/,
  /\bslip\b/i,
  /\bphone\b/i,
  /\bเบอร์\b/,
  /\bcustomer\b/i,
  /\bลูกค้า\b/,
  /promptpay/i,
];

test('the merchant e-mail body carries only shop name, count/codes and the admin link', () => {
  const built = buildMerchantEmail({
    shopName: 'ร้านทดสอบ',
    queueCodes: ['BK-7K2M9Q', 'BK-1A2B3C'],
    adminUrl: 'https://admin.bk01.wstera.com/dashboard',
    kind: 'immediate',
  });

  assert.match(built.text, /ร้านทดสอบ/);
  assert.match(built.text, /BK-7K2M9Q/);
  assert.match(built.text, /BK-1A2B3C/);
  assert.match(built.text, /Items awaiting review: 2/);
  assert.match(built.html, /https:\/\/admin\.bk01\.wstera\.com\/dashboard/);
});

test('a caller cannot smuggle customer detail, an amount or a slip path into the body', () => {
  // The input type names three fields; this object deliberately carries more and
  // every one of them must be ignored -- an inbox is a weaker boundary than the
  // admin session.
  const hostile = {
    shopName: 'ร้านทดสอบ',
    queueCodes: ['BK-7K2M9Q'],
    adminUrl: 'https://admin.bk01.wstera.com/dashboard',
    kind: 'immediate' as const,
    customerName: 'สมชาย ใจดี',
    customerPhone: '0812345678',
    customerEmail: 'somchai@example.com',
    amount: 500,
    slipUrl: 'booking-1/9f8e7d6c-1234-4abc-9def-1234567890ab.jpg',
    depositStatus: 'submitted',
  };
  const built = buildMerchantEmail(hostile);

  assert.doesNotMatch(built.text, /สมชาย/);
  assert.doesNotMatch(built.text, /0812345678/);
  assert.doesNotMatch(built.text, /somchai/);
  assert.doesNotMatch(built.text, /500/);
  assert.doesNotMatch(built.text, /9f8e7d6c/);
  assert.doesNotMatch(built.html, /สมชาย|0812345678|somchai|9f8e7d6c/);
  // The subject is the other half of what reaches an inbox.
  assert.doesNotMatch(built.subject, /สมชาย|0812345678|somchai|500|9f8e7d6c/);
});

test('every rendered merchant e-mail is free of customer, amount and slip markers', () => {
  for (const kind of ['immediate', 'daily_summary'] as const) {
    const built = buildMerchantEmail({
      shopName: 'Good Cuts Barber',
      queueCodes: ['BK-AAAAAA', 'BK-BBBBBB'],
      adminUrl: 'https://admin.bk01.wstera.com/dashboard',
      kind,
    });
    for (const pattern of FORBIDDEN_IN_BODY) {
      assert.doesNotMatch(built.text, pattern, `text leaked ${pattern} for ${kind}`);
    }
  }
});

test('a non-code queue value is dropped rather than rendered', () => {
  const built = buildMerchantEmail({
    shopName: 'ร้านทดสอบ',
    queueCodes: ['BK-OK1234', 'สมชาย 0812345678', '<script>alert(1)</script>', 'BK-OK1234'],
    adminUrl: 'https://admin.bk01.wstera.com/dashboard',
    kind: 'immediate',
  });
  assert.match(built.text, /BK-OK1234/);
  assert.doesNotMatch(built.text, /สมชาย/);
  assert.doesNotMatch(built.text, /script/);
  assert.match(built.text, /Items awaiting review: 1/, 'duplicates and rejects both drop out of the count');
});

test('the channel resolver sends the shop to e-mail and the customer to LINE', () => {
  assert.equal(resolveNotificationChannel('shop_owner'), 'email');
  assert.equal(resolveNotificationChannel('customer'), 'line');
  assert.equal(resolveNotificationChannel('unknown'), null);
  assert.equal(resolveNotificationChannel(null), null);
  assert.equal(isMerchantEmailEvent('shop_owner'), true);
  assert.equal(isMerchantEmailEvent('customer'), false);
});

test('with no key the transport fails closed and does not touch any other channel', async () => {
  const config = readMerchantEmailConfig({});
  assert.equal(config.apiKey, null);
  assert.equal(config.from, null);
  assert.equal(isMerchantEmailConfigured(config), false);

  const configWithHalf = readMerchantEmailConfig({ RESEND_API_KEY: 're_test_key' });
  assert.equal(isMerchantEmailConfigured(configWithHalf), false, 'a key without a sender is still not configured');

  let fetchCalls = 0;
  const transport = createResendTransport(config, (async () => { fetchCalls += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch);
  const result = await transport.send({ to: 'owner@example.com', subject: 's', text: 't', html: '<p>h</p>' });
  assert.equal(result.ok, false);
  assert.equal(result.error, EMAIL_NOT_CONFIGURED);
  assert.equal(fetchCalls, 0, 'an unconfigured transport must make no outbound call at all');
});

test('the Resend adapter is really called, with the right endpoint and payload', async () => {
  const config = readMerchantEmailConfig({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'shop@wstera.com' });
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const transport = createResendTransport(config, (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response('{"id":"msg_1"}', { status: 200 });
  }) as unknown as typeof fetch);

  const result = await transport.send({ to: 'owner@example.com', subject: 'รายการใหม่', text: 'body', html: '<p>body</p>' });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.resend.com/emails');
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.from, 'shop@wstera.com');
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.equal(body.subject, 'รายการใหม่');
  assert.equal(body.text, 'body');
  assert.equal(body.html, '<p>body</p>');
});

test('a provider failure is reported, never converted into a sent', async () => {
  const config = readMerchantEmailConfig({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'shop@wstera.com' });
  const transport = createResendTransport(config, (async () => new Response('{"message":"unauthorized"}', { status: 401 })) as unknown as typeof fetch);
  const result = await transport.send({ to: 'owner@example.com', subject: 's', text: 't', html: 'h' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(String(result.error), /401/);

  const throwing = createResendTransport(config, (async () => { throw new Error('network down'); }) as unknown as typeof fetch);
  const threw = await throwing.send({ to: 'owner@example.com', subject: 's', text: 't', html: 'h' });
  assert.equal(threw.ok, false);
  assert.equal(threw.status, 0);
});
