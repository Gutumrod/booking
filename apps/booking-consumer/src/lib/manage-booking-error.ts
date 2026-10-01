// B6b (ง) — turn the raw server errors a customer hits on the manage-booking page
// into plain language.
//
// Today `manage-booking/page.tsx` prints `error.message` straight from PostgREST,
// so a customer who reschedules onto a slot someone else just took sees the raw
// text `conflicting key value violates exclusion constraint
// "prevent_overlapping_staff_bookings"` (reproduced against a throwaway cluster:
// SQLSTATE 23P01). Every error below was verified against the real functions in
// supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql, not guessed.
//
// Pure and framework-free: the caller passes its own translated strings, so this
// module holds no Thai/English copy of its own.
//
// Anything unrecognised falls back to the caller's generic "could not complete"
// message rather than echoing the raw database text.

export type ManageBookingErrorKind =
  | 'slot_taken'
  | 'outside_availability'
  | 'date_closed'
  | 'staff_inactive'
  | 'policy_closed'
  | 'invalid_link'
  | 'unknown';

export interface ManageBookingErrorMessages {
  slotTaken: string;
  outsideAvailability: string;
  dateClosed: string;
  staffInactive: string;
  policyClosed: string;
  invalidLink: string;
  outcomeFailed: string;
}

/** What the caller can hand us: a PostgREST error object or a returned error string. */
export interface ManageBookingErrorInput {
  /** PostgREST error code, e.g. '23P01'. */
  code?: string | null;
  /** PostgREST error message, or the `error` field of the function's JSON reply. */
  message?: string | null;
}

/** The constraint name as the database reports it (product_rules_v1.sql:102). */
export const OVERLAP_CONSTRAINT = 'prevent_overlapping_staff_bookings';

export function classifyManageBookingError(input: ManageBookingErrorInput): ManageBookingErrorKind {
  const code = (input.code ?? '').trim();
  const message = (input.message ?? '').trim();

  // A raw exclusion violation, either as SQLSTATE 23P01 or by constraint name.
  if (code === '23P01') return 'slot_taken';
  if (message.includes(OVERLAP_CONSTRAINT)) return 'slot_taken';

  // Messages raised by the functions themselves (verbatim from the migration).
  if (message.includes('Invalid or expired booking recovery token')) return 'invalid_link';
  if (message.includes('Requested time is outside staff availability')) return 'outside_availability';
  if (message.includes('Requested date is closed')) return 'date_closed';
  if (message.includes('Assigned staff is no longer active')) return 'staff_inactive';
  if (
    message.includes('Cancellation policy window has closed')
    || message.includes('Reschedule policy window has closed')
    || message.includes('policy is not configured')
  ) {
    return 'policy_closed';
  }

  return 'unknown';
}

/** Resolve the kind to the caller's own translated string. */
export function manageBookingErrorMessage(
  input: ManageBookingErrorInput,
  messages: ManageBookingErrorMessages,
): string {
  switch (classifyManageBookingError(input)) {
    case 'slot_taken':
      return messages.slotTaken;
    case 'outside_availability':
      return messages.outsideAvailability;
    case 'date_closed':
      return messages.dateClosed;
    case 'staff_inactive':
      return messages.staffInactive;
    case 'policy_closed':
      return messages.policyClosed;
    case 'invalid_link':
      return messages.invalidLink;
    default:
      // Never echo raw database text at the customer.
      return messages.outcomeFailed;
  }
}
