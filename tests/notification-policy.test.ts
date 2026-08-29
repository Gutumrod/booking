import assert from 'node:assert/strict';
import test from 'node:test';

import { nextNotificationAttempt } from '../apps/booking-consumer/src/lib/notification-policy.ts';

test('backs off failed delivery without changing booking truth', () => {
  assert.deepEqual(nextNotificationAttempt({ attemptCount: 1, bookingStatus: 'confirmed', delivered: false }), {
    status: 'pending',
    nextRetrySeconds: 120,
  });
});

test('stops canceled reminders and caps provider retries', () => {
  assert.deepEqual(nextNotificationAttempt({ attemptCount: 1, bookingStatus: 'cancelled', delivered: false }), {
    status: 'failed',
    nextRetrySeconds: null,
  });
  assert.deepEqual(nextNotificationAttempt({ attemptCount: 5, bookingStatus: 'confirmed', delivered: false }), {
    status: 'failed',
    nextRetrySeconds: null,
  });
  assert.deepEqual(nextNotificationAttempt({ attemptCount: 1, bookingStatus: 'confirmed', delivered: true }), {
    status: 'sent',
    nextRetrySeconds: null,
  });
});
