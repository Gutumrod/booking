import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePaymentInstruction,
  preHoldServiceDeposit,
} from '../apps/booking-consumer/src/lib/payment-instruction.ts';

const complete = {
  promptpayNumber: '0812345678',
  promptpayName: 'Good Cuts Co Ltd',
  holdDepositAmount: 150,
};

test('complete tuple is ok', () => {
  assert.deepEqual(resolvePaymentInstruction(complete), {
    ok: true,
    number: '0812345678',
    name: 'Good Cuts Co Ltd',
    amount: 150,
  });
});

test('missing number fails closed', () => {
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayNumber: null }).ok, false);
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayNumber: '   ' }).ok, false);
});

test('missing or blank account name fails closed (never derived)', () => {
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayName: null }).ok, false);
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayName: '' }).ok, false);
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayName: '   ' }).ok, false);
  assert.equal(resolvePaymentInstruction({ ...complete, promptpayName: null }).name, null);
});

test('non-positive / non-finite / missing hold amount fails closed', () => {
  for (const bad of [null, undefined, 0, -50, Number.NaN, Number.POSITIVE_INFINITY] as const) {
    const r = resolvePaymentInstruction({ ...complete, holdDepositAmount: bad });
    assert.equal(r.ok, false, `amount ${String(bad)} must not be ok`);
    assert.equal(r.amount, null);
  }
});

test('an incomplete tuple never yields a usable amount or recipient for rendering', () => {
  const r = resolvePaymentInstruction({ promptpayNumber: '08', promptpayName: null, holdDepositAmount: 100 });
  assert.equal(r.ok, false);
  // callers gate every payment control on r.ok, so name null here means no identity is shown
  assert.equal(r.name, null);
});

test('preHoldServiceDeposit keeps null vs explicit zero distinct, no shop default', () => {
  assert.equal(preHoldServiceDeposit(null), null);
  assert.equal(preHoldServiceDeposit(undefined), null);
  assert.equal(preHoldServiceDeposit(0), 0);
  assert.equal(preHoldServiceDeposit(200), 200);
});
