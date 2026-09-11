import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseNumericField,
  commitNumericField,
  DURATION_RULES,
  DURATION_INPUT_PROPS,
  nativeNumberInputAccepts,
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

// NEW-F10: the native <input> contract must not block values the commit guard
// accepts. Every positive integer minute must pass BOTH the native constraint
// check and the commit guard.
test('duration input contract lets every positive integer reach the commit guard', () => {
  assert.equal(DURATION_INPUT_PROPS.min, 1);
  assert.equal(DURATION_INPUT_PROPS.step, 1);
  for (let minutes = 1; minutes <= 600; minutes += 1) {
    assert.ok(nativeNumberInputAccepts(minutes, DURATION_INPUT_PROPS), `native input must accept ${minutes}`);
    assert.equal(commitNumericField(String(minutes), DURATION_RULES).error, null, `commit guard must accept ${minutes}`);
  }
  assert.equal(nativeNumberInputAccepts(0, DURATION_INPUT_PROPS), false);
  // regression evidence: the old step={5} contract blocked these before the guard
  for (const minutes of [2, 37, 90]) {
    assert.equal(nativeNumberInputAccepts(minutes, { min: 1, step: 5 }), false, `step 5 blocks ${minutes}`);
  }
});

test('dashboard duration input uses the shared contract, no five-minute step', () => {
  const src = readFileSync(new URL('../apps/booking-admin/src/app/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /\{\.\.\.DURATION_INPUT_PROPS\}/);
  assert.match(src, /commitNumericField\(serviceDuration, DURATION_RULES\)/);
  assert.doesNotMatch(src, /step=\{5\}/);
  assert.doesNotMatch(src, /% ?15/);
});
