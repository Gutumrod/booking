/**
 * G36, second half — "ไม่ล้างไฟล์ค้าง". The decision logic behind
 * `scripts/cleanup-stale-deposit-slips.mjs`, kept pure and separate from the CLI so
 * the safety property can be tested without a database or a bucket.
 *
 * THE PROBLEM THIS SOLVES. `authorize_deposit_slip_upload` registers an object path
 * and a signed upload URL for every caller who holds a live booking token. Nothing
 * requires the holder to then call `submit_deposit_slip`. An object that is uploaded
 * through a URL but never submitted is referenced by NO row: `bookings.slip_url`
 * never learns about it, and the grant row that authorised it has expired by then.
 * It is invisible residue, 5 MB at a time. (See `g36-upload-intent-abuse.test.ts`
 * for the admission-control half; this module is about the leftovers.)
 *
 * THE ONLY HARD RULE. A deposit slip attached to a booking is the customer's payment
 * evidence. Deleting one is not clean-up, it is destroying a receipt during a dispute
 * window — so this planner will not delete a referenced object under ANY age, and it
 * will not delete an object whose provenance it cannot establish. Everything it does
 * decide to delete is an object that (a) matches the deposit-slip path contract,
 * (b) has a readable, old timestamp, (c) has no live upload grant, and (d) is referred
 * to by no booking. Missing evidence is always resolved as KEEP.
 *
 * NOTHING HERE DELETES ANYTHING. It returns a plan; the caller decides what to do
 * with it, and the CLI refuses to act on it without an explicit flag.
 */

const OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|jpeg|png|webp)$/i;

/** Booking statuses in which the slip is still the shop's live evidence. */
export const ACTIVE_BOOKING_STATUSES = Object.freeze(['hold', 'pending_review', 'confirmed']);

/**
 * `hold` and `pending_review` are the states in which the customer is still being
 * asked for the slip; `confirmed` is a paid booking whose slip may still be disputed.
 * A completed or cancelled booking keeps its slip too — see the "bound-to-booking"
 * reason — but it is not "active".
 */
function isActiveBooking(booking) {
  return ACTIVE_BOOKING_STATUSES.includes(String(booking?.status ?? '').toLowerCase());
}

function parseObjectPath(name) {
  const match = PATH_PATTERN.exec(String(name ?? ''));
  if (!match) return null;
  return { bookingId: match[1].toLowerCase(), objectId: match[2].toLowerCase() };
}

/**
 * Read a required fact list, or refuse.
 *
 * WHY THIS IS NOT A FALLBACK (F2, both paired reviewers on `4d067fd`). This planner used
 * to read a missing key as an empty list. With `bookings` absent, `referencedPaths` was
 * empty, so a slip that a customer's booking still points at looked like orphaned
 * residue — the one guarantee this tool exists to keep, defeated by a typo in the
 * operator's facts file, with a plausible `planSha256` printed for `--apply` to act on.
 * Missing evidence must never read as "safe to delete": a fact list that is absent, null
 * or not an array stops the plan instead of shrinking it.
 */
function requiredList(input, key) {
  const value = input?.[key];
  if (!Array.isArray(value)) {
    throw new TypeError(
      `facts.${key} must be an array; ${value === undefined ? 'it is missing' : `it is ${JSON.stringify(value)}`}. `
      + 'A missing list is not an empty list — reading it as one would let this plan delete evidence it cannot see.',
    );
  }
  return value;
}

/**
 * Plan the removal of stale deposit-slip objects.
 *
 * @param {object} input
 * @param {Array<{name: string, created_at?: string|null}>} input.objects storage inventory
 * @param {Array<{id: string, status?: string, slip_url?: string|null}>} input.bookings
 * @param {Array<{object_path: string, expires_at?: string|null}>} input.grants upload grants
 * @param {Date|string} [input.now]
 * @param {number} input.minAgeHours grace window; REQUIRED on purpose
 * @returns {{deletable: Array<{path: string, bookingId: string, createdAt: string}>, kept: Array<{path: string, reason: string}>, summary: object}}
 */
export function planDepositSlipCleanup(input) {
  const now = input?.now instanceof Date ? input.now : new Date(input?.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date');
  const minAgeHours = input?.minAgeHours;
  if (typeof minAgeHours !== 'number' || !Number.isFinite(minAgeHours) || minAgeHours <= 0) {
    throw new TypeError('minAgeHours must be a positive number of hours; a default would delete on a guess');
  }

  const objects = requiredList(input, 'objects');
  const bookings = requiredList(input, 'bookings');
  const grants = requiredList(input, 'grants');

  // Every path a booking points at. A slip is referenced if ANY booking names it,
  // regardless of that booking's age or status.
  const referencedPaths = new Set(
    bookings.map((booking) => booking?.slip_url).filter((value) => typeof value === 'string' && value.length > 0),
  );
  const activePaths = new Set(
    bookings
      .filter(isActiveBooking)
      .map((booking) => booking?.slip_url)
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
  const liveGrantPaths = new Set();
  for (const [index, grant] of grants.entries()) {
    const expiry = grant?.expires_at ? new Date(grant.expires_at) : null;
    if (!expiry || Number.isNaN(expiry.getTime())) {
      /*
       * An unreadable grant expiry is not evidence that the grant is dead. Treating it
       * as expired would delete an object a customer may be uploading through right
       * now, so the plan stops instead of guessing either way (F2: the reviewers measured
       * a live grant becoming deletable this way).
       */
      throw new TypeError(
        `facts.grants[${index}].expires_at is missing or unreadable (${JSON.stringify(grant?.expires_at ?? null)}); `
        + 'an unreadable expiry is not evidence that the upload grant has expired',
      );
    }
    if (expiry.getTime() > now.getTime()) {
      const path = grant?.object_path;
      if (typeof path === 'string' && path.length > 0) liveGrantPaths.add(path);
    }
  }

  const cutoffMs = now.getTime() - minAgeHours * 60 * 60 * 1000;
  const deletable = [];
  const kept = [];

  for (const object of objects) {
    const path = String(object?.name ?? '');
    const parsed = parseObjectPath(path);
    if (!parsed) {
      kept.push({ path, reason: 'unrecognised-path-shape' });
      continue;
    }
    if (activePaths.has(path)) {
      kept.push({ path, reason: 'bound-to-active-booking' });
      continue;
    }
    if (referencedPaths.has(path)) {
      kept.push({ path, reason: 'bound-to-booking' });
      continue;
    }
    if (liveGrantPaths.has(path)) {
      kept.push({ path, reason: 'upload-grant-still-live' });
      continue;
    }
    const createdAt = object?.created_at ? new Date(object.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      kept.push({ path, reason: 'age-unknown' });
      continue;
    }
    if (createdAt.getTime() > cutoffMs) {
      kept.push({ path, reason: 'inside-grace-window' });
      continue;
    }
    deletable.push({ path, bookingId: parsed.bookingId, createdAt: createdAt.toISOString() });
  }

  return {
    deletable,
    kept,
    summary: {
      inspected: objects.length,
      deletable: deletable.length,
      kept: kept.length,
      minAgeHours,
      now: now.toISOString(),
    },
  };
}

/** Format a plan for a human reading a terminal. Never prints object contents. */
export function formatPlan(plan, { dryRun }) {
  const lines = [];
  lines.push(`${dryRun ? 'DRY RUN' : 'APPLY'} — deposit-slip stale-object plan`);
  lines.push(`inspected ${plan.summary.inspected}; deletable ${plan.summary.deletable}; kept ${plan.summary.kept}; grace ${plan.summary.minAgeHours}h`);

  if (plan.deletable.length > 0) {
    lines.push('');
    lines.push(`deletable objects (${plan.deletable.length}):`);
    for (const entry of plan.deletable) {
      lines.push(`  delete ${entry.path} (uploaded ${entry.createdAt})`);
    }
  }

  const keptByReason = new Map();
  for (const entry of plan.kept) {
    keptByReason.set(entry.reason, (keptByReason.get(entry.reason) ?? 0) + 1);
  }
  if (keptByReason.size > 0) {
    lines.push('');
    lines.push('kept objects by reason:');
    for (const [reason, count] of [...keptByReason].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${reason}: ${count}`);
    }
  }

  if (dryRun) {
    lines.push('');
    lines.push('DRY RUN: nothing was deleted. Re-run with --apply and an authorized operator to act.');
  }
  return lines.join('\n');
}
