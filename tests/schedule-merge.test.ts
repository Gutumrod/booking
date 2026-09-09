import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeServerSchedules } from '../apps/booking-admin/src/lib/schedule-merge.ts';

const local = [
  { staffId: 'a', v: 'local-a-edited' },
  { staffId: 'b', v: 'local-b-edited' },
];
const server = [
  { staffId: 'a', v: 'server-a' },
  { staffId: 'b', v: 'server-b' },
  { staffId: 'c', v: 'server-c' },
];

test('saving staff a does not disturb staff b unsaved edits', () => {
  // b is still dirty, a was just saved (no longer dirty)
  const merged = mergeServerSchedules(local, server, new Set(['b']));
  assert.deepEqual(merged, [
    { staffId: 'a', v: 'server-a' },
    { staffId: 'b', v: 'local-b-edited' },
    { staffId: 'c', v: 'server-c' },
  ]);
});

test('nothing dirty => server wins entirely', () => {
  assert.deepEqual(mergeServerSchedules(local, server, new Set()), server);
});

test('dirty staff missing from previous falls back to server row', () => {
  const merged = mergeServerSchedules([], server, new Set(['a']));
  assert.equal(merged.find((s) => s.staffId === 'a')!.v, 'server-a');
});

test('dirty staff removed on the server is dropped', () => {
  const merged = mergeServerSchedules(local, [{ staffId: 'b', v: 'server-b' }], new Set(['a', 'b']));
  assert.deepEqual(merged, [{ staffId: 'b', v: 'local-b-edited' }]);
});
