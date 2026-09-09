import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeInput, stepTime } from '../apps/booking-admin/src/lib/time-input.ts';

test('bare hours', () => {
  assert.equal(parseTimeInput('9'), '09:00');
  assert.equal(parseTimeInput('12'), '12:00');
  assert.equal(parseTimeInput('0'), '00:00');
});

test('digit runs without a colon', () => {
  assert.equal(parseTimeInput('930'), '09:30');
  assert.equal(parseTimeInput('1230'), '12:30');
  assert.equal(parseTimeInput('123'), '01:23');
});

test('with a colon, partial minutes', () => {
  assert.equal(parseTimeInput('9:5'), '09:05');
  assert.equal(parseTimeInput('09:30'), '09:30');
  assert.equal(parseTimeInput('9:'), '09:00');
});

test('strips stray characters', () => {
  assert.equal(parseTimeInput(' 9:30 น. '), '09:30');
});

test('rejects out-of-range and empty', () => {
  assert.equal(parseTimeInput(''), null);
  assert.equal(parseTimeInput('25:00'), null);
  assert.equal(parseTimeInput('12:60'), null);
  assert.equal(parseTimeInput('99'), null);
  assert.equal(parseTimeInput(':30'), null);
});

test('stepTime wraps within a day', () => {
  assert.equal(stepTime('09:00', 15), '09:15');
  assert.equal(stepTime('09:00', -15), '08:45');
  assert.equal(stepTime('23:50', 15), '00:05');
  assert.equal(stepTime('00:05', -15), '23:50');
});
