import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness, isShopReady, isValidPromptPayRecipient } from '../apps/booking-admin/src/lib/readiness.ts';

const noDepositShop = {
  shopName: 'Good Cuts',
  shopPhone: '021234567',
  promptpayNumber: '',
  promptpayName: '',
  requireDeposit: false,
  defaultDepositAmount: null,
  services: [{ isActive: true, deposit: null }],
  staff: [{ isActive: true }],
  schedules: [{ days: [{ isWorkingDay: false }, { isWorkingDay: true }] }],
};

const depositShop = {
  ...noDepositShop,
  requireDeposit: true,
  defaultDepositAmount: 100,
  promptpayNumber: '0812345678',
  promptpayName: 'Good Cuts Co',
  services: [{ isActive: true, deposit: 200 }],
};

type Input = Parameters<typeof computeReadiness>[0];
const payment = (input: Input) => computeReadiness(input).find((r) => r.key === 'payment')!.status;

test('no-deposit shop is payment-ready without any PromptPay onboarding', () => {
  assert.equal(payment(noDepositShop), 'ready');
  assert.equal(payment({ ...noDepositShop, services: [{ isActive: true, deposit: 300 }] }), 'ready');
});

// R2-2 / F3: NULL is "not set", never a successful readiness result.
test('require_deposit=true with no configured amount anywhere -> payment attention', () => {
  assert.equal(payment({ ...noDepositShop, requireDeposit: true }), 'attention');
  // even with a complete PromptPay identity, the amount is still unresolvable
  assert.equal(
    payment({ ...noDepositShop, requireDeposit: true, promptpayNumber: '0812345678', promptpayName: 'Good Cuts Co' }),
    'attention',
  );
  // no active services and no shop default
  assert.equal(payment({ ...depositShop, defaultDepositAmount: null, services: [] }), 'attention');
});

test('require_deposit=true with one active service unresolvable -> attention', () => {
  const shop = {
    ...depositShop,
    defaultDepositAmount: null,
    services: [{ isActive: true, deposit: 200 }, { isActive: true, deposit: null }],
  };
  assert.equal(payment(shop), 'attention');
  // an inactive unresolvable service does not count
  assert.equal(
    payment({ ...shop, services: [{ isActive: true, deposit: 200 }, { isActive: false, deposit: null }] }),
    'ready',
  );
});

test('deposit-required + resolvable amount + complete identity -> payment ready', () => {
  assert.equal(payment(depositShop), 'ready');
  assert.equal(payment({ ...depositShop, defaultDepositAmount: null }), 'ready'); // per-service amount
  assert.equal(payment({ ...depositShop, services: [{ isActive: true, deposit: null }] }), 'ready'); // shop default
  assert.equal(payment({ ...depositShop, promptpayNumber: '1234567890123' }), 'ready');
});

test('deposit-required missing number -> payment attention', () => {
  assert.equal(payment({ ...depositShop, promptpayNumber: '' }), 'attention');
});

test('deposit-required malformed number -> payment attention', () => {
  assert.equal(payment({ ...depositShop, promptpayNumber: 'not-a-number' }), 'attention');
  assert.equal(payment({ ...depositShop, promptpayNumber: '12345' }), 'attention');
});

test('deposit-required missing account name -> payment attention', () => {
  assert.equal(payment({ ...depositShop, promptpayName: '   ' }), 'attention');
});

test('explicit zero everywhere is a configured "no deposit" -> ready without PromptPay', () => {
  const shop = { ...depositShop, promptpayNumber: '', promptpayName: '', defaultDepositAmount: null, services: [{ isActive: true, deposit: 0 }] };
  assert.equal(payment(shop), 'ready');
  assert.equal(payment({ ...shop, defaultDepositAmount: 0, services: [{ isActive: true, deposit: null }] }), 'ready');
});

test('explicit zero mixed with a positive amount still needs PromptPay', () => {
  const shop = { ...depositShop, services: [{ isActive: true, deposit: 0 }, { isActive: true, deposit: 150 }] };
  assert.equal(payment(shop), 'ready');
  assert.equal(payment({ ...shop, promptpayNumber: '' }), 'attention');
});

test('null default is not treated as zero', () => {
  // with a null default, an unset service does not resolve to 0
  const shop = { ...depositShop, promptpayNumber: '', promptpayName: '', defaultDepositAmount: null, services: [{ isActive: true, deposit: null }] };
  assert.equal(payment(shop), 'attention');
});

test('isValidPromptPayRecipient mirrors the consumer format contract', () => {
  for (const ok of ['0812345678', '081-234-5678', '1234567890123']) assert.equal(isValidPromptPayRecipient(ok), true, ok);
  for (const bad of ['', 'not-a-number', '12345', '081234567', '1812345678']) assert.equal(isValidPromptPayRecipient(bad), false, bad);
});

test('missing profile phone', () => {
  const rows = computeReadiness({ ...noDepositShop, shopPhone: '  ' });
  assert.equal(rows.find((r) => r.key === 'profile')!.status, 'attention');
  assert.equal(isShopReady(rows), false);
});

test('no active service / staff / working day', () => {
  assert.equal(
    computeReadiness({ ...noDepositShop, services: [{ isActive: false, deposit: null }] }).find((r) => r.key === 'services')!.status,
    'attention',
  );
  assert.equal(
    computeReadiness({ ...noDepositShop, staff: [] }).find((r) => r.key === 'staff')!.status,
    'attention',
  );
  assert.equal(
    computeReadiness({ ...noDepositShop, schedules: [{ days: [{ isWorkingDay: false }] }] }).find((r) => r.key === 'schedule')!.status,
    'attention',
  );
});
