/**
 * H1 (round 2) — parity between the ONE refund predicate in the app and the ONE
 * refund predicate in the SQL spec handed to ก้อน 5.
 *
 * Why this file exists: in round 1 the app and the spec each had their own
 * version of "may the shop settle this deposit?", and they disagreed (the app
 * released `expired` with a future end and hid `confirmed`/`hold` once their end
 * had passed; the spec did the opposite). Codex failed the round on that
 * divergence. The caretaker then fixed ONE formula (STATUS-HOUSE A-9, verdict
 * after round 2, item 1):
 *
 *     deposit_status IN ('submitted','verified')
 *     AND ( status IN ('cancelled','no_show','completed') OR end_timestamptz < now() )
 *
 * This module gives a re-runnable check of two independent claims:
 *
 *   1. TEXT parity  — the executable predicate line inside the SQL spec is the
 *      same expression as the one generated from the app's exported constants
 *      (character for character, after stripping the `v_booking.` qualifier and
 *      collapsing whitespace). Change either side alone and it fails.
 *   2. CASE parity  — one case table evaluated twice: once by the real TS
 *      `canRecordRefund()`, once by an evaluator whose status lists and time test
 *      are PARSED OUT OF THE SQL SPEC. If the spec stops containing that shape,
 *      the parse throws instead of silently agreeing.
 *
 * No database, no network: both sides are text + pure functions.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Resolve a repo-relative path next to this file (evidence/ lives at the repo root). */
const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

export const SPEC_PATH = repoPath('evidence/b8-spec-v2-addendum-for-group5.sql');
export const ELIGIBILITY_PATH = repoPath('apps/booking-admin/src/lib/refund-eligibility.ts');

if (!existsSync(SPEC_PATH) || !existsSync(ELIGIBILITY_PATH)) {
  throw new Error(`parity inputs missing: ${SPEC_PATH} / ${ELIGIBILITY_PATH}`);
}

const { REFUND_HELD_DEPOSIT_STATES, SETTLED_QUEUE_STATUSES, canRecordRefund } = await import(
  pathToFileURL(ELIGIBILITY_PATH).href
);

const quoteList = (values) => values.map((value) => `'${value}'`).join(', ');

/**
 * The canonical expression, built from the app's exported constants. This string
 * is what the SQL spec's executable predicate must normalise to.
 */
export const CANONICAL_EXPRESSION =
  `deposit_status IN (${quoteList(REFUND_HELD_DEPOSIT_STATES)})`
  + ` AND ( status IN (${quoteList(SETTLED_QUEUE_STATUSES)})`
  + ` OR end_timestamptz < now() )`;

/** Collapse whitespace and drop the row qualifier so both dialects compare. */
export const normaliseSqlExpression = (expression) => expression
  .replace(/\bv_booking\./g, '')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')')
  .trim();

/**
 * Pull the executable refund predicate out of the spec: everything between
 * `v_refundable :=` and its terminating semicolon, with comment lines removed.
 * Throws when the spec no longer carries that assignment at all — a spec that
 * silently lost its predicate must not pass.
 */
export function extractRefundPredicate(sql) {
  const body = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const match = body.match(/v_refundable\s*:=\s*([\s\S]*?);/);
  if (!match) {
    throw new Error('SQL spec no longer contains a `v_refundable := ...;` predicate');
  }
  return match[1];
}

/** Normalised predicate text as it appears in the spec. */
export function specPredicateExpression(sql) {
  return normaliseSqlExpression(extractRefundPredicate(sql));
}

/**
 * The SQL predicate as data, parsed from the spec text. Anything missing throws:
 * the point is to read the spec, not to restate it.
 */
export function parseSqlPredicate(sql) {
  const expression = extractRefundPredicate(sql);
  const depositMatch = expression.match(/deposit_status\s+IN\s*\(([^)]*)\)/);
  const statusMatch = expression.match(/\bstatus\s+IN\s*\(([^)]*)\)/);
  const timeMatch = expression.match(/end_timestamptz\s*<\s*now\(\)/);
  if (!depositMatch || !statusMatch || !timeMatch) {
    throw new Error('SQL spec predicate is not in the agreed shape (deposit IN ... AND (status IN ... OR end < now()))');
  }
  const parseList = (raw) => raw.split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
  return {
    depositStates: parseList(depositMatch[1]),
    settledStatuses: parseList(statusMatch[1]),
    usesEndTime: true,
  };
}

/** Evaluate the parsed SQL predicate over one case. NULL end means "not over". */
export function evaluateSqlPredicate(parsed, booking, nowIso) {
  if (!parsed.depositStates.includes(booking.depositStatus)) return false;
  if (parsed.settledStatuses.includes(booking.status)) return true;
  if (booking.endTime === null || booking.endTime === undefined) return false;
  const endMs = Date.parse(booking.endTime);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(endMs) || Number.isNaN(nowMs)) return false;
  return endMs < nowMs;
}

// ---------------------------------------------------------------------------
// The shared case table — brief 23 §5c verdict item (1), case by case.
// ---------------------------------------------------------------------------

export const NOW = '2026-10-01T17:00:00+07:00'; // Fri 1 Oct 2026, 17:00 Bangkok
export const END_PAST = '2026-10-01T16:00:00+07:00';
export const END_FUTURE = '2026-10-01T20:00:00+07:00';

const caseOf = (
  id,
  status,
  depositStatus,
  endTime,
  expected,
  note,
  divergence = null,
) => ({ id, status, depositStatus, endTime, expected, note, divergence });

export const CASES = Object.freeze([
  caseOf('expired + future end', 'expired', 'verified', END_FUTURE, false,
    'the name "expired" is not a queue release; the appointment is still ahead'),
  caseOf('expired + past end', 'expired', 'verified', END_PAST, true,
    'qualifies through end < now(), not through its status'),
  caseOf('confirmed + past end', 'confirmed', 'verified', END_PAST, true,
    'end < now() is not gated by status'),
  caseOf('confirmed + future end', 'confirmed', 'verified', END_FUTURE, false,
    'the customer has not arrived'),
  caseOf('hold + past end', 'hold', 'verified', END_PAST, true,
    'a hold whose appointment has ended may be settled'),
  caseOf('hold + future end', 'hold', 'submitted', END_FUTURE, false,
    'still holding the queue'),
  caseOf('pending_review + past end', 'pending_review', 'verified', END_PAST, true,
    'the ก้อน 1 leftover case'),
  caseOf('pending_review + future end', 'pending_review', 'verified', END_FUTURE, false,
    'the shop must decide before the appointment ends'),
  caseOf('cancelled', 'cancelled', 'verified', END_FUTURE, true,
    'settled status, clock irrelevant'),
  caseOf('no_show', 'no_show', 'verified', END_FUTURE, true, ''),
  caseOf('completed', 'completed', 'verified', END_FUTURE, true, ''),
  caseOf('cancelled + deposit rejected (persisted shape)', 'cancelled', 'rejected', END_FUTURE, false,
    'a refused slip is not money the shop holds - replaces the round-1 H1c fixture that used a booking status of `rejected`'),
  caseOf('hold + deposit rejected (the real refusal shape)', 'hold', 'rejected', END_PAST, false,
    'the CHECK constraint cannot produce booking status rejected, so this is how a refusal persists'),
  caseOf('deposit refunded', 'cancelled', 'refunded', END_FUTURE, false, 'already settled'),
  caseOf('deposit awaiting', 'completed', 'awaiting', END_FUTURE, false, 'no money received'),
  caseOf('deposit not_required', 'completed', 'not_required', END_FUTURE, false, 'no deposit at all'),
  caseOf('unreadable end time', 'pending_review', 'verified', 'nonsense', false,
    'fail closed'),
  // The one KNOWN, DOCUMENTED divergence. The app can derive the end from
  // booking_date + start_time + service duration_minutes when end_timestamptz is
  // NULL (admin-service carries all three); a pure SQL predicate cannot derive, so
  // it refuses the row until backfill. This is the limitation the round-1 report
  // already declared, and it must stay visible rather than be smoothed over.
  caseOf('no end time at all (app derives, SQL refuses)', 'pending_review', 'verified', null, null,
    'documented divergence: app derivation vs SQL refusal; read-only preflight + backfill before GO',
    { ts: true, spec: false }),
]);

/** The divergence ids the round-1 report already declared. A new one must fail. */
export const DOCUMENTED_DIVERGENCES = Object.freeze([
  'no end time at all (app derives, SQL refuses)',
]);

/** Run the whole table through both implementations. */
export function runParity(cases = CASES, now = NOW) {
  const sql = readFileSync(SPEC_PATH, 'utf8');
  const parsed = parseSqlPredicate(sql);
  return cases.map((entry) => {
    const booking = {
      status: entry.status,
      depositStatus: entry.depositStatus,
      endTime: entry.endTime,
      date: '2026-10-01',
      time: '14:00',
      durationMinutes: 120,
    };
    const ts = canRecordRefund(booking, now);
    const spec = evaluateSqlPredicate(parsed, booking, now);
    const expectedTs = entry.divergence ? entry.divergence.ts : entry.expected;
    const expectedSpec = entry.divergence ? entry.divergence.spec : entry.expected;
    return {
      ...entry,
      ts,
      spec,
      agree: ts === spec,
      ok: ts === expectedTs && spec === expectedSpec,
    };
  });
}

/** Small façade so the test file reads the same artefacts the spec ships with. */
export const RUNNER = Object.freeze({
  specPath: SPEC_PATH,
  eligibilityPath: ELIGIBILITY_PATH,
  readSpec: () => readFileSync(SPEC_PATH, 'utf8'),
  readEligibility: () => readFileSync(ELIGIBILITY_PATH, 'utf8'),
  canonicalExpression: CANONICAL_EXPRESSION,
});
