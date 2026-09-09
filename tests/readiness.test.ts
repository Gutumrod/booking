import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness, isShopReady } from '../apps/booking-admin/src/lib/readiness.ts';

const ready = {
  shopName: 'Good Cuts',
  shopPhone: '021234567',
  promptpayNumber: '0812345678',
  services: [{ isActive: true }, { isActive: false }],
  staff: [{ isActive: true }],
  schedules: [{ days: [{ isWorkingDay: false }, { isWorkingDay: true }] }],
};

test('a fully configured shop is ready on every row', () => {
  const rows = computeReadiness(ready);
  assert.deepEqual(rows.map((r) => r.key), ['profile', 'services', 'staff', 'schedule', 'payment']);
  assert.ok(isShopReady(rows));
});

test('missing profile phone', () => {
  const rows = computeReadiness({ ...ready, shopPhone: '  ' });
  assert.equal(rows.find((r) => r.key === 'profile')!.ok, false);
  assert.equal(isShopReady(rows), false);
});

test('no active service / staff', () => {
  assert.equal(
    computeReadiness({ ...ready, services: [{ isActive: false }] }).find((r) => r.key === 'services')!.ok,
    false,
  );
  assert.equal(
    computeReadiness({ ...ready, staff: [] }).find((r) => r.key === 'staff')!.ok,
    false,
  );
});

test('schedule needs at least one working day somewhere', () => {
  assert.equal(
    computeReadiness({ ...ready, schedules: [{ days: [{ isWorkingDay: false }] }] })
      .find((r) => r.key === 'schedule')!.ok,
    false,
  );
});

test('payment row tracks PromptPay presence', () => {
  assert.equal(
    computeReadiness({ ...ready, promptpayNumber: '' }).find((r) => r.key === 'payment')!.ok,
    false,
  );
});
