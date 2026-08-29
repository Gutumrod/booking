import assert from 'node:assert/strict';
import test from 'node:test';

import {
  crc16CcittFalse,
  createPromptPayPayload,
} from '../apps/booking-consumer/src/lib/promptpay.ts';

test('implements the published CRC-16/CCITT-FALSE check vector', () => {
  assert.equal(crc16CcittFalse('123456789'), '29B1');
});

test('creates a deterministic dynamic PromptPay payload without customer data', () => {
  const payload = createPromptPayPayload({ recipient: '081-234-5678', amount: 100 });
  assert.match(payload, /^00020101021229370016A0000006770101110113006681234567853037645406100\.005802TH6304[A-F0-9]{4}$/);
  assert.equal(payload, createPromptPayPayload({ recipient: '0812345678', amount: 100 }));
  assert.equal(crc16CcittFalse(payload.slice(0, -4)), payload.slice(-4));
});

test('rejects invalid recipients and amounts', () => {
  assert.throws(() => createPromptPayPayload({ recipient: '123', amount: 100 }), /recipient/i);
  assert.throws(() => createPromptPayPayload({ recipient: '0812345678', amount: 0 }), /amount/i);
  assert.throws(() => createPromptPayPayload({ recipient: '0812345678', amount: Number.NaN }), /amount/i);
});

