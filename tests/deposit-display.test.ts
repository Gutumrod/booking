import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDepositDisplay } from '../apps/booking-consumer/src/lib/deposit-display.ts';

test('no recipient => never show a QR, even with an amount', () => {
  assert.deepEqual(
    resolveDepositDisplay({ serviceDepositAmount: 200, promptpayNumber: null }),
    { amount: 200, showQr: false },
  );
});

test('no amount anywhere => amount null, no QR', () => {
  assert.deepEqual(
    resolveDepositDisplay({ promptpayNumber: '0812345678' }),
    { amount: null, showQr: false },
  );
});

test('server hold amount wins over service and shop default', () => {
  assert.deepEqual(
    resolveDepositDisplay({
      holdDepositAmount: 150,
      serviceDepositAmount: 200,
      shopDefaultDepositAmount: 300,
      promptpayNumber: '0812345678',
    }),
    { amount: 150, showQr: true },
  );
});

test('falls back service -> shop default when no hold', () => {
  assert.equal(resolveDepositDisplay({ serviceDepositAmount: 200, promptpayNumber: '08' }).amount, 200);
  assert.equal(resolveDepositDisplay({ shopDefaultDepositAmount: 90, promptpayNumber: '08' }).amount, 90);
});

test('zero amount does not produce a QR', () => {
  assert.deepEqual(
    resolveDepositDisplay({ holdDepositAmount: 0, promptpayNumber: '0812345678' }),
    { amount: 0, showQr: false },
  );
});

test('null default is not treated as 0', () => {
  const r = resolveDepositDisplay({
    serviceDepositAmount: null,
    shopDefaultDepositAmount: null,
    promptpayNumber: '0812345678',
  });
  assert.equal(r.amount, null);
  assert.equal(r.showQr, false);
});
