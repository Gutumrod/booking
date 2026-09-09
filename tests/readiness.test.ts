import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness, isShopReady, depositIsCollectable } from '../apps/booking-admin/src/lib/readiness.ts';

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

test('no-deposit shop is fully ready without any PromptPay onboarding', () => {
  const rows = computeReadiness(noDepositShop);
  assert.equal(rows.find((r) => r.key === 'payment')!.status, 'ready');
  assert.ok(isShopReady(rows));
});

test('require_deposit=true but no configured amount anywhere -> deposit not collectable -> payment ready', () => {
  const rows = computeReadiness({ ...noDepositShop, requireDeposit: true });
  assert.equal(depositIsCollectable({ ...noDepositShop, requireDeposit: true }), false);
  assert.equal(rows.find((r) => r.key === 'payment')!.status, 'ready');
});

test('deposit-required + complete PromptPay identity -> payment ready', () => {
  const rows = computeReadiness(depositShop);
  assert.equal(rows.find((r) => r.key === 'payment')!.status, 'ready');
  assert.ok(isShopReady(rows));
});

test('deposit-required missing number -> payment attention', () => {
  const rows = computeReadiness({ ...depositShop, promptpayNumber: '' });
  assert.equal(rows.find((r) => r.key === 'payment')!.status, 'attention');
  assert.equal(isShopReady(rows), false);
});

test('deposit-required missing account name -> payment attention', () => {
  const rows = computeReadiness({ ...depositShop, promptpayName: '   ' });
  assert.equal(rows.find((r) => r.key === 'payment')!.status, 'attention');
});

test('per-service amount makes deposit collectable even with null shop default', () => {
  const shop = { ...depositShop, defaultDepositAmount: null, services: [{ isActive: true, deposit: 150 }] };
  assert.equal(depositIsCollectable(shop), true);
  assert.equal(computeReadiness(shop).find((r) => r.key === 'payment')!.status, 'ready');
});

test('null default is not treated as zero; explicit-zero service does not make a deposit collectable', () => {
  const shop = { ...depositShop, defaultDepositAmount: null, services: [{ isActive: true, deposit: 0 }] };
  assert.equal(depositIsCollectable(shop), false);
  assert.equal(computeReadiness(shop).find((r) => r.key === 'payment')!.status, 'ready');
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
