/**
 * When the dashboard may offer the "completed" and "no-show" actions (BK01 P0 H6 —
 * council finding G06 on the UI side, and G35's lesson about where the time comes
 * from).
 *
 * WHY THE UI HAS A GATE AT ALL. The SQL guard is the authority: after the P0 SQL set,
 * `set_booking_outcome` refuses `completed` on a booking whose appointment has not
 * started (finding G06, brief 28 §3 S10). A button that is offered and then refused
 * is a worse experience than a button that is not offered — the shop assumes the
 * click worked, the row does not change, and the queue silently stays open. H6 asks
 * for the button to be hidden before the appointment, so the UI agrees with the guard
 * instead of discovering it.
 *
 * WHERE THE TIME COMES FROM — THE POINT OF G35. The earlier F-17 defect was a gate
 * that reconstructed the appointment instant by string-matching `booking_date` and
 * `start_time` against a hard-coded `+07:00` offset. Any row whose time text was not
 * exactly `HH:MM` (an import, a manual edit, a null) made the gate answer "not
 * started" FOREVER, so the shop could never mark a no-show and fell back to
 * `cancel_booking` — a different state with different money and statistics.
 *
 * This gate therefore takes the SERVER's `end_timestamptz` and nothing else. It is a
 * real instant, it handles a null by saying so, and it never parses a display string.
 *
 * FAIL DIRECTION IS DELIBERATE AND IS THE OPPOSITE OF THE OLD GATE. When the instant
 * is missing the gate ANSWERS `true` (offer the action) rather than `false`: the SQL
 * guard is the authority and it rejects what it must, whereas hiding the button on a
 * row the shop legitimately needs to close has no recovery path at all. The two
 * directions are asserted in `tests/house-p0-app-completed-gate.test.ts`.
 *
 * Pure and framework-free so `tests/` can pin it without a clock or a browser.
 */

/** The server-supplied instants the gate needs. Both are ISO-8601 or null. */
export interface BookingOutcomeTiming {
  /** `bookings.end_timestamptz` as the server returned it. */
  endTime?: string | null;
  /** `bookings.start_timestamptz` as the server returned it. Optional: an older
   *  projection may not carry it, and `endTime` alone is enough. */
  startTime?: string | null;
}

export interface AppointmentTimingDecision {
  /** True when the appointment instant has been reached (or cannot be judged). */
  reached: boolean;
  /** Why, for the operator and for the tests. */
  basis: 'end_time_passed' | 'start_time_passed' | 'instant_missing' | 'instant_invalid' | 'appointment_in_future';
}

/**
 * Whether the appointment has been reached and the outcome actions may be offered.
 *
 * `endTime` is the primary fact (a no-show is only decidable once the appointment has
 * finished); `startTime` is a fallback for a projection that carries no end. A missing
 * or unparseable instant answers `reached: true` so the SQL guard decides — see the
 * header.
 */
export function resolveAppointmentReached(
  booking: BookingOutcomeTiming,
  now: Date = new Date(),
): AppointmentTimingDecision {
  const end = parseInstant(booking.endTime);
  if (end === 'missing' || end === 'invalid') {
    const start = parseInstant(booking.startTime);
    if (start instanceof Date) {
      return start.getTime() <= now.getTime()
        ? { reached: true, basis: 'start_time_passed' }
        : { reached: true, basis: 'instant_missing' };
    }
    return { reached: true, basis: end === 'missing' ? 'instant_missing' : 'instant_invalid' };
  }
  return end.getTime() <= now.getTime()
    ? { reached: true, basis: 'end_time_passed' }
    : { reached: false, basis: 'appointment_in_future' };
}

/**
 * Whether the outcome actions should be SHOWN. A thin alias so the call site reads as
 * the question it is asking, and so the fail direction lives in one place.
 */
export function canOfferOutcomeActions(
  booking: BookingOutcomeTiming,
  now: Date = new Date(),
): boolean {
  return resolveAppointmentReached(booking, now).reached;
}

function parseInstant(value: string | null | undefined): Date | 'missing' | 'invalid' {
  if (value === null || value === undefined) return 'missing';
  const text = String(value).trim();
  if (text.length === 0) return 'missing';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed;
}
