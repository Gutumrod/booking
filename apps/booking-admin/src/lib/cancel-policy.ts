// Customer cancel/reschedule policy windows for the shop dashboard (B6 / B6b).
//
// Both policies are enforced server-side by local_service.customer_cancel_booking
// and local_service.customer_reschedule_booking, which read
// local_service.shops.customer_cancel_before_hours / customer_reschedule_before_hours
// and RAISE "policy is not configured" while the column is NULL. Every shop row
// created so far has both columns NULL, so no customer can cancel OR reschedule
// today (verified by running the real functions against the throwaway cluster).
//
// Owner decisions (STATUS-HOUSE A-20, 2026-10-01): cancel-ahead defaults to 24
// hours; reschedule-ahead defaults to 12 hours. Each may be changed by the shop.
// Changing the database default and backfilling existing NULL rows is a migration
// the controller owns (this work unit ships the SQL as a spec, never runs it), so
// this module states the value each screen must show while the column is unset,
// plus the field's validation rule. Both are pure and framework-free so they can
// be unit-tested from `tests/`.
import type { NumericFieldRules } from './numeric-field';

/** Owner-approved default cancel-ahead window, shown while the column is NULL. */
export const DEFAULT_CUSTOMER_CANCEL_BEFORE_HOURS = 24;

/** Owner-approved default reschedule-ahead window, shown while the column is NULL. */
export const DEFAULT_CUSTOMER_RESCHEDULE_BEFORE_HOURS = 12;

/**
 * Whole hours, 0 or more. 0 means "allowed right up to the appointment", which is
 * what the SQL policy already does when the column is 0; a negative window has no
 * meaning and the database CHECK rejects it too
 * (`... IS NULL OR ... >= 0` for both columns).
 */
export const CANCEL_POLICY_HOURS_RULES = { min: 0, integer: true } as const satisfies NumericFieldRules;

/** Spread onto a policy-hours <input>; step 1 so every whole hour is submittable. */
export const CANCEL_POLICY_HOURS_INPUT_PROPS = {
  type: 'number',
  min: 0,
  step: 1,
  inputMode: 'numeric',
} as const;
