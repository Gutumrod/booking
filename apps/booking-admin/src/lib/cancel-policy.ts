// Customer cancel/reschedule policy window for the shop dashboard (B6).
//
// The policy itself is enforced server-side by
// local_service.customer_cancel_booking / customer_reschedule_booking, which
// read local_service.shops.customer_cancel_before_hours and RAISE when the
// column is NULL ("Customer cancellation policy is not configured"). Every shop
// row created so far has that column NULL, so no customer can cancel today.
//
// Owner decision (STATUS-HOUSE A-20, 2026-10-01): the default cancel-ahead
// window is 24 hours and the shop may change it. Changing the database default
// and backfilling existing NULL rows is a migration the controller owns (this
// work unit ships the SQL as a spec, never runs it), so this module states the
// value the screen must show while the column is unset, plus the field's
// validation rule. Both are pure and framework-free so they can be unit-tested
// from `tests/`.
import type { NumericFieldRules } from './numeric-field';

/** Owner-approved default shown while the shop's column is still NULL. */
export const DEFAULT_CUSTOMER_CANCEL_BEFORE_HOURS = 24;

/**
 * Whole hours, 0 or more. 0 means "cancellable right up to the appointment",
 * which is what the SQL policy already does when the column is 0; a negative
 * window has no meaning and the database CHECK rejects it too
 * (`customer_cancel_before_hours IS NULL OR customer_cancel_before_hours >= 0`).
 */
export const CANCEL_POLICY_HOURS_RULES = { min: 0, integer: true } as const satisfies NumericFieldRules;

/** Spread onto the cancel-hours <input>; step 1 so every whole hour is submittable. */
export const CANCEL_POLICY_HOURS_INPUT_PROPS = {
  type: 'number',
  min: 0,
  step: 1,
  inputMode: 'numeric',
} as const;
