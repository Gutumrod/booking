import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePaymentInstruction,
  preHoldServiceDeposit,
  isValidPromptPayRecipient,
  isPromptPayIdentityComplete,
  createPromptPayPayload,
  crc16CcittFalse,
} from '../apps/booking-consumer/src/lib/payment-instruction.ts';

const complete = {
  promptpayNumber: '0812345678',
  promptpayName: 'Good Cuts Co Ltd',
  holdDepositAmount: 150,
};

test('complete tuple is ok and carries the encodable QR payload', () => {
  assert.deepEqual(resolvePaymentInstruction(complete), {
    ok: true,
    number: '0812345678',
    name: 'Good Cuts Co Ltd',
    amount: 150,
    payload: createPromptPayPayload({ recipient: '0812345678', amount: 150 }),
  });
});

test('13-digit ID and dashed mobile recipients are valid', () => {
  const id = resolvePaymentInstruction({ ...complete, promptpayNumber: '1234567890123' });
  assert.equal(id.ok, true);
  const dashed = resolvePaymentInstruction({ ...complete, promptpayNumber: '081-234-5678' });
  assert.equal(dashed.ok, true);
  if (dashed.ok) assert.equal(crc16CcittFalse(dashed.payload.slice(0, -4)), dashed.payload.slice(-4));
});

// R2-1: a non-empty string is not a PromptPay recipient.
test('malformed non-empty recipient fails closed with no usable number or payload', () => {
  for (const bad of ['not-a-number', '12345', '081234567', '08123456789', '1812345678', '123456789012', 'abc0812345678x9']) {
    assert.equal(isValidPromptPayRecipient(bad), false, `${bad} must be invalid`);
    const r = resolvePaymentInstruction({ ...complete, promptpayNumber: bad });
    assert.equal(r.ok, false, `${bad} must not be ok`);
    assert.equal(r.number, null);
    assert.equal(r.payload, null);
  }
});

test('amount beyond the PromptPay field limit fails closed (no payload, not ok)', () => {
  const r = resolvePaymentInstruction({ ...complete, holdDepositAmount: 1_000_000_000 });
  assert.equal(r.ok, false);
  assert.equal(r.payload, null);
});

test('ok is true only when the QR payload encodes -- every ok instruction is payable', () => {
  const numbers = [null, '', '  ', 'not-a-number', '0812345678', '1234567890123'];
  const names = [null, '', 'Shop Co'];
  const amounts = [null, 0, -1, Number.NaN, 150, 1_000_000_000];
  for (const promptpayNumber of numbers) for (const promptpayName of names) for (const holdDepositAmount of amounts) {
    const r = resolvePaymentInstruction({ promptpayNumber, promptpayName, holdDepositAmount });
    if (r.ok) {
      assert.equal(r.payload, createPromptPayPayload({ recipient: r.number, amount: r.amount }));
    } else {
      assert.equal(r.payload, null);
    }
  }
});

test('identity is complete only with a format-valid number and a configured name', () => {
  assert.equal(isPromptPayIdentityComplete('0812345678', 'Shop Co'), true);
  assert.equal(isPromptPayIdentityComplete('not-a-number', 'Shop Co'), false);
  assert.equal(isPromptPayIdentityComplete('0812345678', '   '), false);
  assert.equal(isPromptPayIdentityComplete(null, 'Shop Co'), false);
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
