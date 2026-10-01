// B10 — "no-show" may only be recorded after the appointment time.
//
// Owner decision (STATUS-HOUSE A-20 / brief 23, 2026-10-01): the merchant may
// mark a booking as a no-show only once the appointment time has passed, and
// nothing may change the status automatically — the shop always presses it.
// The UI gate mirrors the same start-time rule enforced by
// local_service.set_booking_outcome in the consolidation migration. It is
// deliberately fail-closed: an unreadable date/time keeps the action closed.
//
// Pure and framework-free so it can be unit-tested from `tests/`.

export interface AppointmentMoment {
  /** `booking_date` as the database returns it: YYYY-MM-DD. */
  date: string;
  /** `start_time` as the dashboard holds it: HH:MM (already sliced to 5 chars). */
  time: string;
}

/**
 * Asia/Bangkok has been a fixed UTC+7 offset with no daylight saving since 1960,
 * so the appointment instant is `date T time +07:00`. Using an explicit offset
 * keeps this independent of the machine's timezone, which is what makes the same
 * gate agree with the shop's own wall clock.
 */
const BANGKOK_OFFSET = '+07:00';

/** The appointment's start instant in epoch ms, or null when the input is unusable. */
export function appointmentStartMs(moment: AppointmentMoment): number | null {
  const date = moment.date?.trim();
  const time = moment.time?.trim();
  if (!date || !time) return null;
  // Accept HH:MM (the dashboard's shape); reject anything that would make Date
  // roll over to a different day or a different instant silently.
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const dateCheck = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (dateCheck.getUTCFullYear() !== Number(year)
      || dateCheck.getUTCMonth() !== Number(month) - 1
      || dateCheck.getUTCDate() !== Number(day)
      || Number(hour) > 23 || Number(minute) > 59) return null;
  const parsed = new Date(`${date}T${time}:00${BANGKOK_OFFSET}`);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True only once the appointment start has passed. Unparseable bookings return
 * false, so the no-show button stays closed rather than opening on bad data.
 */
export function hasAppointmentStarted(moment: AppointmentMoment, nowMs: number): boolean {
  const startMs = appointmentStartMs(moment);
  if (startMs === null) return false;
  return nowMs >= startMs;
}
