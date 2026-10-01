/**
 * The appointment-time guard for CUSTOMER reminders (BK01 brief 23, part B9(ข)).
 *
 * `local_service.claim_due_line_notifications` decides whether a row may be
 * delivered from `scheduled_for` alone. It never looks at the booking, so a
 * `reminder_24h` whose appointment has already happened is still claimed and
 * still pushed: "your appointment is in 24 hours" about an appointment that was
 * three hours ago. Reproduced on PG 17.11 -- see
 * runtime/relay/house-20260927/codex-par/HOUSE-BK01-NOTIFY/pg17/repro-b9b.out.
 *
 * The insert-time guard that already exists (`suppress_new_overdue_line_reminder`,
 * BK-SR-03) closes only half of it: it refuses to CREATE a reminder whose
 * `scheduled_for` has already passed, so a stale row cannot be born. It says
 * nothing about the appointment, so a row created while the appointment was still
 * in the future -- and then not dispatched until after it -- still goes out.
 *
 * Fixing the claim itself is SQL owned by the queue-lock unit (brief 23 §0.2),
 * so this unit supplies the predicate and the app-side check that agrees with it.
 * The SQL spec is in docs/design/BK01-NOTIFY-DESIGN-2026-10-01.md section 5.
 *
 * Pure and framework-free so `tests/` can pin it without a database.
 */

/** Reminder events that are worthless (and misleading) once the appointment is past. */
export const APPOINTMENT_BOUND_REMINDERS: readonly string[] = ['reminder_1h', 'reminder_24h'];

export interface ClaimableNotification {
  eventType: string;
  appointmentStart: string | null;
  /** Injected so the decision is deterministic under test. */
  now: Date;
}

export type ClaimDecision =
  | { claimable: true }
  | { claimable: false; reason: 'appointment_already_passed' | 'appointment_unknown' };

/**
 * Whether a claimed row should actually be delivered.
 *
 * An unparseable or missing appointment is treated as NOT claimable for a
 * reminder, because the whole point of a reminder is its appointment: a reminder
 * that cannot be tied to one cannot be shown to be timely, and sending a
 * mistimed reminder is worse than skipping it. Non-reminder events pass through
 * untouched -- a cancellation notice has no appointment-time requirement.
 *
 * This mirrors the SQL predicate exactly, so the app and the database cannot
 * disagree about which reminders are stale.
 */
export function resolveReminderClaim(input: ClaimableNotification): ClaimDecision {
  if (!APPOINTMENT_BOUND_REMINDERS.includes(input.eventType)) return { claimable: true };

  if (!input.appointmentStart) return { claimable: false, reason: 'appointment_unknown' };
  const appointment = Date.parse(input.appointmentStart);
  if (!Number.isFinite(appointment)) return { claimable: false, reason: 'appointment_unknown' };

  if (appointment <= input.now.getTime()) {
    return { claimable: false, reason: 'appointment_already_passed' };
  }
  return { claimable: true };
}

/**
 * How a skipped reminder is recorded. It is not a delivery failure: nothing was
 * tried and nothing is retried. It is retired with the reason attached so the
 * outbox explains itself instead of showing an unexplained `failed`.
 */
export function skippedReminderOutcome(reason: 'appointment_already_passed' | 'appointment_unknown'): {
  status: 'failed';
  message: string;
} {
  return reason === 'appointment_already_passed'
    ? { status: 'failed', message: 'Skipped: appointment time has already passed' }
    : { status: 'failed', message: 'Skipped: appointment time is unavailable' };
}
