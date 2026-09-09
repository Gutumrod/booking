import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumericField,
  commitNumericField,
} from '../apps/booking-admin/src/lib/numeric-field.ts';

test('empty string is allowed while editing, rejected on commit', () => {
  assert.deepEqual(parseNumericField(''), { value: null, error: null });
  assert.deepEqual(parseNumericField('   '), { value: null, error: null });
  assert.deepEqual(commitNumericField(''), { value: null, error: 'required' });
});

test('valid numbers parse', () => {
  assert.deepEqual(parseNumericField('45', { min: 1, integer: true }), { value: 45, error: null });
  assert.deepEqual(parseNumericField('350'), { value: 350, error: null });
  assert.deepEqual(commitNumericField('0', { min: 0 }), { value: 0, error: null });
});

test('non-numeric input is an error, not silently zero', () => {
  assert.equal(parseNumericField('abc').error, 'not-a-number');
  assert.equal(parseNumericField('12x').error, 'not-a-number');
  assert.equal(parseNumericField('abc').value, null);
});

test('integer rule rejects fractions', () => {
  assert.equal(parseNumericField('12.5', { integer: true }).error, 'not-integer');
  assert.deepEqual(parseNumericField('12', { integer: true }), { value: 12, error: null });
});

test('range rules', () => {
  assert.equal(parseNumericField('-3', { min: 0 }).error, 'below-min');
  assert.equal(parseNumericField('500', { max: 365 }).error, 'above-max');
  assert.deepEqual(parseNumericField('60', { min: 1, max: 365 }), { value: 60, error: null });
});

test('commit reuses the parse rules', () => {
  assert.equal(commitNumericField('12.5', { integer: true }).error, 'not-integer');
  assert.equal(commitNumericField('-1', { min: 0 }).error, 'below-min');
});

// Service duration: any positive integer minute is valid on the client
// (Amendment A1 / Codex F5). The multiple-of-15 rule is NOT a client constraint;
// the pre-R7 RPC rejection is surfaced separately.
test('duration client validation accepts any positive integer minute', () => {
  const rules = { min: 1, integer: true };
  for (const raw of ['1', '5', '15', '37', '90']) {
    assert.deepEqual(commitNumericField(raw, rules), { value: Number(raw), error: null }, `duration ${raw}`);
  }
});

test('duration client validation still rejects 0 and fractional', () => {
  const rules = { min: 1, integer: true };
  assert.equal(commitNumericField('0', rules).error, 'below-min');
  assert.equal(commitNumericField('12.5', rules).error, 'not-integer');
  assert.equal(commitNumericField('', rules).error, 'required');
});
