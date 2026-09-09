// Loose HH:MM time-entry parsing for the schedule editor (KMO-02).
//
// Native <input type="time"> was the only entry path and hard to operate on the
// tested mobile browser. These helpers back a keyboard-friendly text field:
// accept "9", "930", "9:5", "09:30" etc. and normalise to canonical "HH:MM"
// (24h). Invalid input returns null so the field can revert to its last valid
// value. Value contract is unchanged ("HH:MM" string) so no RPC/schema impact.
//
// Pure and framework-free for unit testing from `tests/`.

export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().replace(/[^\d:]/g, '');
  if (s === '') return null;

  let hours: number;
  let minutes: number;

  if (s.includes(':')) {
    const [hp, mp = ''] = s.split(':');
    if (hp === '') return null;
    hours = Number(hp);
    minutes = mp === '' ? 0 : Number(mp);
  } else if (s.length <= 2) {
    hours = Number(s);
    minutes = 0;
  } else {
    // "930" -> 09:30, "1230" -> 12:30
    hours = Number(s.slice(0, s.length - 2));
    minutes = Number(s.slice(s.length - 2));
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Add `deltaMinutes` to an "HH:MM" value, wrapping within a day. */
export function stepTime(value: string, deltaMinutes: number): string {
  const parsed = parseTimeInput(value) ?? '00:00';
  const [h, m] = parsed.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
