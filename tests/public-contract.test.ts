import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('current public surfaces contain no annual checkout or remote PromptPay QR path', () => {
  const surfaces = [
    read('apps/booking-admin/src/app/register/page.tsx'),
    read('apps/booking-admin/src/app/api/billing/checkout/route.ts'),
    read('apps/booking-consumer/src/app/book/[slug]/page.tsx'),
  ].join('\n');

  assert.doesNotMatch(surfaces, /promptpay\.io/i);
  assert.doesNotMatch(surfaces, /annual|yearly|4900|9900/i);
});

test('current package copy states provisional pricing and no paid booking wall', () => {
  for (const path of ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json']) {
    const messages = JSON.parse(read(path));
    const dashboard = JSON.stringify(messages.dashboard);
    assert.match(dashboard, /pilot|นำร่อง/i);
    assert.doesNotMatch(dashboard, /100%|guaranteed/i);
    assert.doesNotMatch(dashboard, /100 bookings|500 bookings|100 คิว|500 คิว/i);
  }
});

test('merchant LINE credentials remain server-only', () => {
  const envTemplate = read('.env.example');
  assert.match(envTemplate, /LINE_MERCHANT_CHANNELS_JSON/);
  assert.doesNotMatch(envTemplate, /NEXT_PUBLIC_LINE_MERCHANT/);
});
