import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPOINTMENT_BOUND_REMINDERS,
  resolveReminderClaim,
  skippedReminderOutcome,
} from '../apps/booking-consumer/src/lib/notification-appointment-guard.ts';

/**
 * B9(b): a 24h reminder must not become "your appointment is in 24 hours" about
 * an appointment that already happened.
 *
 * Reproduced on real PostgreSQL 17.11 with the repo's own
 * `claim_due_line_notifications` (evidence:
 * runtime/relay/house-20260927/codex-par/HOUSE-BK01-NOTIFY/pg17/repro-b9b.out):
 * the claim predicate contains no reference to the appointment, so a row whose
 * `scheduled_for` has passed is handed out regardless of whether the appointment
 * is behind us. The existing insert-time guard only refuses rows that are ALREADY
 * overdue at insert time, so a row created while the appointment was still in the
 * future and dispatched late still goes out.
 *
 * These tests pin the app-side half of the fix; the SQL predicate is a spec for
 * the queue-lock unit (docs/design/BK01-NOTIFY-DESIGN-2026-10-01.md section 5).
 */

const NOW = new Date('2026-10-01T05:00:00Z');

test('a reminder for an appointment already in the past is not delivered', () => {
  for (const eventType of APPOINTMENT_BOUND_REMINDERS) {
    assert.deepEqual(
      resolveReminderClaim({ eventType, appointmentStart: '2026-10-01T02:00:00Z', now: NOW }),
      { claimable: false, reason: 'appointment_already_passed' },
      `${eventType} must not go out after the appointment`,
    );
  }
});

test('a reminder for an appointment still ahead is delivered', () => {
  assert.deepEqual(
    resolveReminderClaim({ eventType: 'reminder_24h', appointmentStart: '2026-10-02T05:00:00Z', now: NOW }),
    { claimable: true },
  );
  assert.deepEqual(
    resolveReminderClaim({ eventType: 'reminder_1h', appointmentStart: '2026-10-01T05:30:00Z', now: NOW }),
    { claimable: true },
  );
});

test('the boundary itself counts as passed', () => {
  // An appointment at exactly now is not "coming up", so it is not reminded.
  assert.deepEqual(
    resolveReminderClaim({ eventType: 'reminder_24h', appointmentStart: '2026-10-01T05:00:00Z', now: NOW }),
    { claimable: false, reason: 'appointment_already_passed' },
  );
});

test('a reminder that cannot be tied to an appointment is skipped, not guessed at', () => {
  for (const appointmentStart of [null, '', 'not-a-date']) {
    assert.deepEqual(
      resolveReminderClaim({ eventType: 'reminder_24h', appointmentStart, now: NOW }),
      { claimable: false, reason: 'appointment_unknown' },
      `appointmentStart=${String(appointmentStart)} must fail closed`,
    );
  }
});

test('non-reminder events are untouched by the appointment guard', () => {
  // A cancellation notice has no timeliness requirement, and suppressing it would
  // be a different bug: the customer would not learn their booking was cancelled.
  for (const eventType of ['booking_created', 'booking_cancelled', 'booking_rescheduled', 'deposit_rejected', 'daily_slip_summary']) {
    assert.deepEqual(
      resolveReminderClaim({ eventType, appointmentStart: '2026-10-01T02:00:00Z', now: NOW }),
      { claimable: true },
      `${eventType} must not be suppressed by the appointment guard`,
    );
  }
});

test('a skipped reminder is retired with a reason and is never retried', () => {
  const passed = skippedReminderOutcome('appointment_already_passed');
  assert.equal(passed.status, 'failed');
  assert.match(passed.message, /appointment time has already passed/);
  const unknown = skippedReminderOutcome('appointment_unknown');
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.message, /unavailable/);
  assert.notEqual(passed.message, unknown.message, 'the two skips must be distinguishable in the outbox');
});

test('the guard covers exactly the reminder events the schema knows about', () => {
  assert.deepEqual([...APPOINTMENT_BOUND_REMINDERS], ['reminder_1h', 'reminder_24h']);
});
