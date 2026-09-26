import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// L-01: every customer-facing surface ships Thai + English. A missing key in one
// language renders a raw key path to a customer, so the key sets must be identical.
const consumer = (name: 'th' | 'en') =>
  JSON.parse(readFileSync(new URL(`../apps/booking-consumer/messages/${name}.json`, import.meta.url), 'utf8'));

const flatten = (value: unknown, prefix = ''): string[] =>
  Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? flatten(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

test('consumer Thai and English message key sets match exactly', () => {
  const th = flatten(consumer('th')).sort();
  const en = flatten(consumer('en')).sort();

  assert.ok(th.length > 0, 'Thai catalogue must not be empty');
  assert.deepEqual(th, en, 'Thai and English message keys must be identical');
});

test('consumer plans page ships the same keys in both languages', () => {
  const thPlans = flatten(consumer('th').plans).sort();
  const enPlans = flatten(consumer('en').plans).sort();

  assert.ok(thPlans.length > 0, 'plans section must exist in Thai');
  assert.deepEqual(thPlans, enPlans, 'plans section keys must be identical');
});

test('plans copy carries only the approved commercial facts', () => {
  const th = consumer('th').plans;
  const en = consumer('en').plans;

  // Free forever: 50 bookings / month, 1 shop, 3 services.
  assert.match(th.free.limitBookings, /50/);
  assert.match(en.free.limitBookings, /50/);
  assert.match(th.free.limitShops, /1/);
  assert.match(th.free.limitServices, /3/);
  assert.match(th.free.badge, /ตลอดไป/);
  assert.match(en.free.badge, /forever/i);

  // Basic: 390 THB in Thai, 11 USD in English (L-07 currency by language, no conversion).
  assert.match(th.basic.price, /390/);
  assert.doesNotMatch(th.basic.price, /\$/);
  assert.match(en.basic.price, /\$11/);
  assert.doesNotMatch(en.basic.price, /390/);

  // Pro must not be presented as buyable and must carry no price.
  assert.doesNotMatch(JSON.stringify({ th, en }), /\b(?:490|990)\b/);
  const proCopy = JSON.stringify({ th: th.pro, en: en.pro });
  assert.doesNotMatch(proCopy, /[฿$]\s?\d|\b\d+\s?(?:THB|USD|บาท|ดอลลาร์)\b/i);
  assert.match(proCopy, /not open for purchase|ยังไม่เปิดให้ซื้อ/);

  // LINE message charges belong to the shop and are paid to LINE.
  assert.match(th.lineCost.body, /LINE/);
  assert.match(en.lineCost.body, /shop pays LINE directly/);

  // Limits are enforced by the product, not hidden.
  assert.match(th.enforcement.body, /บังคับใช้/);
  assert.match(en.enforcement.body, /enforced by the product/);
});

test('plans copy contains no social proof or invented testimonials', () => {
  const body = JSON.stringify([consumer('th').plans, consumer('en').plans]);
  const forbidden = [
    /testimonial/i,
    /\b\d(?:\.\d)?\s*\/\s*5\b/,          // star ratings
    /\bstars?\b/i,
    /\brating\b/i,
    /\breview(?:s|ed)?\b/i,
    /ความคิดเห็นจากลูกค้า|คะแนนรีวิว|รีวิวจาก/i,
    /\b(?:trusted by|customers?\s+count|used by)\b/i,
    /\b\d+\+?\s*(?:shops|businesses|merchants|users|ร้านค้า)\b/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(body, pattern);
  }
});
