/**
 * When the dashboard may offer the "completed" and "no-show" actions (BK01 P0 H6 —
 * council finding G06 on the UI side, and G35's lesson about where the time comes
 * from).
 *
 * WHY THE UI HAS A GATE AT ALL. The SQL guard is the authority: after the P0 SQL set,
 * `local_service.set_booking_outcome` refuses the outcome unless the appointment has
 * STARTED — `bookings.start_timestamptz IS NOT NULL AND start_timestamptz <= now()`.
 * A button that is offered and then refused is a worse experience than a button that
 * is not offered — the shop assumes the click worked, the row does not change, and the
 * queue silently stays open. H6 asks for the button to be hidden before the
 * appointment starts, so the UI agrees with the guard instead of discovering it.
 *
 * WHERE THE TIME COMES FROM — THE POINT OF G35. The earlier F-17 defect was a gate
 * that reconstructed the appointment instant by string-matching `booking_date` and
 * `start_time` against a hard-coded `+07:00` offset. Any row whose time text was not
 * exactly `HH:MM` (an import, a manual edit, a null) made the gate answer "not
 * started" FOREVER, so the shop could never mark a no-show and fell back to
 * `cancel_booking` — a different state with different money and statistics.
 *
 * This gate therefore takes the SERVER's `start_timestamptz` and `end_timestamptz` and
 * never parses a display string.
 *
 * THE START INSTANT IS THE PRIMARY FACT, because it is the instant the SQL guard
 * tests. `startTime` reached -> offer the action; `startTime` still in the future ->
 * do not offer it. `startTime` missing or unparseable -> fall back to `endTime` when
 * that is a usable instant (an older projection may not carry the start); if neither
 * instant is usable the gate ANSWERS `true` so the SQL guard, not the button, decides.
 *
 * FAIL DIRECTION IS DELIBERATE. When no usable instant is present the gate offers the
 * action rather than hiding it: the SQL guard rejects what it must, whereas hiding the
 * button on a row the shop legitimately needs to close has no recovery path at all.
 * Both directions are asserted in `tests/house-p0-app-h6.test.ts`.
 *
 * Pure and framework-free so `tests/` can pin it without a clock or a browser.
 */

/** The server-supplied instants the gate needs. Both are ISO-8601 or null. */
export interface BookingOutcomeTiming {
  /** `bookings.start_timestamptz` as the server returned it. The primary fact — the
   *  instant `set_booking_outcome` itself tests. Optional: a projection may omit it. */
  startTime?: string | null;
  /** `bookings.end_timestamptz` as the server returned it. The fallback for a
   *  projection that carries no usable start. */
  endTime?: string | null;
}

export interface AppointmentTimingDecision {
  /** True when the appointment instant has been reached (or cannot be judged). */
  reached: boolean;
  /**
   * Which instant decided, for the operator and for the tests. The `*_start_time_*`
   * codes name the PRIMARY start instant; `end_time_reached_fallback` and
   * `appointment_in_future` name the end instant, used only when the start is
   * unusable; `instant_missing` / `instant_invalid` name the deliberate fail-open.
   */
  basis:
    | 'start_time_reached'
    | 'start_time_in_future'
    | 'end_time_reached_fallback'
    | 'appointment_in_future'
    | 'instant_missing'
    | 'instant_invalid';
}

/**
 * Whether the appointment has been reached and the outcome actions may be offered.
 *
 * The START instant is the primary decider — the same fact the SQL guard tests — and
 * the END instant is only consulted when the start is missing or unparseable. A booking
 * with no usable instant answers `reached: true` so the SQL guard decides — see the
 * header.
 */
export function resolveAppointmentReached(
  booking: BookingOutcomeTiming,
  now: Date = new Date(),
): AppointmentTimingDecision {
  // PRIMARY FACT: the start instant the SQL guard itself tests.
  const start = parseInstant(booking.startTime);
  if (start instanceof Date) {
    return start.getTime() <= now.getTime()
      ? { reached: true, basis: 'start_time_reached' }
      : { reached: false, basis: 'start_time_in_future' };
  }

  // FALLBACK: the start is unusable, so the end instant decides when it is usable.
  const end = parseInstant(booking.endTime);
  if (end instanceof Date) {
    return end.getTime() <= now.getTime()
      ? { reached: true, basis: 'end_time_reached_fallback' }
      : { reached: false, basis: 'appointment_in_future' };
  }

  // Neither instant is usable: fail OPEN so the SQL guard is the authority.
  return {
    reached: true,
    basis: start === 'invalid' || end === 'invalid' ? 'instant_invalid' : 'instant_missing',
  };
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
