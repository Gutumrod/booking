import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countAwaitingSlipReview,
  readSlipAlertSoundPreference,
  resolveOverdueBadge,
  shouldPlaySlipAlert,
  SLIP_ALERT_SOUND_STORAGE_KEY,
  SLIP_POLL_INTERVAL_MS,
} from '../apps/booking-admin/src/lib/merchant-alert.ts';

test('the awaiting badge counts pending_review rows and nothing else', () => {
  const bookings = [
    { status: 'pending_review' },
    { status: 'pending_review' },
    { status: 'hold' },
    { status: 'confirmed' },
    { status: 'cancelled' },
  ];
  assert.equal(countAwaitingSlipReview(bookings), 2);
  assert.equal(countAwaitingSlipReview([]), 0);
});

test('the overdue badge fails closed while the queue-lock counter does not exist', () => {
  // This is the point of the whole module: "we cannot count this yet" must never
  // render as the number 0, because 0 tells the shop there is nothing to decide.
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 3, overdueUndecided: null }), { kind: 'unavailable' });
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 0, overdueUndecided: null }), { kind: 'unavailable' });
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 1, overdueUndecided: undefined as unknown as null }), { kind: 'unavailable' });
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 1, overdueUndecided: -1 }), { kind: 'unavailable' });
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 1, overdueUndecided: 1.5 }), { kind: 'unavailable' });

  // And when the counter does arrive it renders a real number, including 0.
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 1, overdueUndecided: 0 }), { kind: 'count', count: 0 });
  assert.deepEqual(resolveOverdueBadge({ awaitingSlip: 1, overdueUndecided: 4 }), { kind: 'count', count: 4 });
});

test('the alert sound fires only on an increase while the page is open', () => {
  const base = { soundEnabled: true, pageVisible: true };
  assert.equal(shouldPlaySlipAlert({ ...base, previousCount: null, nextCount: 5 }), false, 'the first snapshot is the baseline');
  assert.equal(shouldPlaySlipAlert({ ...base, previousCount: 1, nextCount: 2 }), true);
  assert.equal(shouldPlaySlipAlert({ ...base, previousCount: 2, nextCount: 2 }), false, 'a poll that changes nothing stays silent');
  assert.equal(shouldPlaySlipAlert({ ...base, previousCount: 2, nextCount: 1 }), false, 'approving a slip must not beep');
  assert.equal(shouldPlaySlipAlert({ ...base, previousCount: 0, nextCount: 0 }), false);
});

test('the sound preference and the hidden tab both suppress the alert', () => {
  assert.equal(shouldPlaySlipAlert({ previousCount: 1, nextCount: 2, soundEnabled: false, pageVisible: true }), false);
  assert.equal(shouldPlaySlipAlert({ previousCount: 1, nextCount: 2, soundEnabled: true, pageVisible: false }), false);
});

test('the sound preference defaults to on and only an explicit "off" turns it off', () => {
  assert.equal(SLIP_ALERT_SOUND_STORAGE_KEY, 'bk01.admin.slipAlertSound');
  assert.equal(readSlipAlertSoundPreference(null), true, 'first visit defaults to on');
  assert.equal(readSlipAlertSoundPreference('on'), true);
  assert.equal(readSlipAlertSoundPreference('off'), false);
  assert.equal(readSlipAlertSoundPreference('garbage'), true, 'an unreadable value falls back to the default, not to off');
});

test('the polling interval is a stated, light value', () => {
  assert.equal(SLIP_POLL_INTERVAL_MS, 60_000);
  const source = readFileSync('apps/booking-admin/src/app/dashboard/page.tsx', 'utf8');
  assert.match(source, /SLIP_POLL_INTERVAL_MS/, 'the dashboard must use the shared interval');
  assert.match(source, /visibilityState/, 'polling must be gated on tab visibility');
  assert.match(source, /activeTab !== 'bookings'/, 'polling must run on the bookings tab only');
});
