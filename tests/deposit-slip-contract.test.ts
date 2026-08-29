import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDepositSlipObjectPath,
  isBookingScopedDepositSlipPath,
} from '../apps/booking-consumer/src/lib/deposit-slip-contract.ts';

test('builds a non-public booking-scoped object reference', () => {
  assert.equal(
    buildDepositSlipObjectPath('11111111-1111-4111-8111-111111111111', 'image/png', '22222222-2222-4222-8222-222222222222'),
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png',
  );
});

test('rejects forged or cross-booking object references', () => {
  assert.equal(isBookingScopedDepositSlipPath('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg'), true);
  assert.equal(isBookingScopedDepositSlipPath('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg'), false);
  assert.equal(isBookingScopedDepositSlipPath('11111111-1111-4111-8111-111111111111', '../file.jpg'), false);
  assert.equal(isBookingScopedDepositSlipPath('11111111-1111-4111-8111-111111111111', 'https://example.com/file.jpg'), false);
});
