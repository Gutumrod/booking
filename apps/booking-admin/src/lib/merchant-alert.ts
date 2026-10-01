/**
 * Admin slip-alert badge (BK01 brief 23, part B3(ก)).
 *
 * Two counts are wanted on the bookings screen:
 *   - "รอตรวจสลิป N"  -- bookings sitting in `pending_review`;
 *   - "ค้างรอตัดสินหลังวันนัด M" -- bookings whose appointment has passed while the
 *     shop still has not decided.
 *
 * The second count does NOT exist yet: the state/flag it needs belongs to the
 * queue-lock work unit (brief 23 section 2, item 2). Until that counter is
 * delivered the screen must not render a number it cannot vouch for, and in
 * particular must never render `0` -- "0 waiting" and "we cannot tell" are
 * different facts and the shop would act on the first one. So the resolver below
 * takes `null` as "not available" and returns an explicit unavailable badge.
 */

export const SLIP_POLL_INTERVAL_MS = 60_000;

export interface BookingLike {
  status: string;
}

export interface PendingDecisionCounts {
  /** Always derivable from the bookings the dashboard already loads. */
  awaitingSlip: number;
  /** `null` until the queue-lock unit ships the overdue counter. */
  overdueUndecided: number | null;
}

export type OverdueBadge =
  | { kind: 'count'; count: number }
  | { kind: 'unavailable' };

export function countAwaitingSlipReview(bookings: readonly BookingLike[]): number {
  return bookings.filter((booking) => booking.status === 'pending_review').length;
}

/**
 * Fail-closed reading of the overdue counter. A negative or non-integer value is
 * treated as unavailable rather than rendered.
 */
export function resolveOverdueBadge(counts: PendingDecisionCounts): OverdueBadge {
  const value = counts.overdueUndecided;
  if (value === null || value === undefined) return { kind: 'unavailable' };
  if (!Number.isInteger(value) || value < 0) return { kind: 'unavailable' };
  return { kind: 'count', count: value };
}

/**
 * Whether a slip-alert sound should fire on this refresh.
 *
 * Fires only on an INCREASE in the awaiting count, so a reload, a reject/approve
 * (which lowers the count) or a poll that returns the same number stays silent.
 * The first snapshot after opening the page establishes the baseline and is
 * always silent -- otherwise opening the screen would beep about work that was
 * already waiting.
 */
export function shouldPlaySlipAlert(input: {
  previousCount: number | null;
  nextCount: number;
  soundEnabled: boolean;
  pageVisible: boolean;
}): boolean {
  if (!input.soundEnabled || !input.pageVisible) return false;
  if (input.previousCount === null) return false;
  return input.nextCount > input.previousCount;
}

/**
 * A short two-tone chime built from an oscillator at call time. No audio asset is
 * added to the repository and no dependency is introduced; the caller owns the
 * AudioContext and must tolerate this returning false when the browser blocks it
 * (autoplay policy before a gesture).
 */
export function playSlipAlertTone(context: AudioContext): boolean {
  try {
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    gain.connect(context.destination);

    for (const [freq, at] of [[880, 0], [1174.66, 0.16]] as const) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.24);
    }
    return true;
  } catch {
    return false;
  }
}

export const SLIP_ALERT_SOUND_STORAGE_KEY = 'bk01.admin.slipAlertSound';

export function readSlipAlertSoundPreference(raw: string | null): boolean {
  return raw === null ? true : raw !== 'off';
}
