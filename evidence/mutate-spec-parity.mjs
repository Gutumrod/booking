// Non-vacuity proof for the round-2 parity gate: mutate the SQL spec seven ways
// and confirm the checker REFUSES every mutant. A gate that accepts a mutated spec
// proves nothing, so this is the evidence that the parity test can actually fail.
//
// Usage: node evidence/mutate-spec-parity.mjs
import {
  CANONICAL_EXPRESSION,
  parseSqlPredicate,
  specPredicateExpression,
  normaliseSqlExpression,
  evaluateSqlPredicate,
} from './refund-predicate-parity.mjs';

const REAL = normaliseSqlExpression(CANONICAL_EXPRESSION);

// The exact executable line the real spec carries, so mutations are surgical.
const BASELINE = `    v_refundable := v_booking.deposit_status IN ('submitted', 'verified')
        AND (
            v_booking.status IN ('cancelled', 'no_show', 'completed')
            OR v_booking.end_timestamptz < now()
        );`;

const wrap = (predicate) => `CREATE OR REPLACE FUNCTION local_service.record_deposit_refund()
RETURNS JSON LANGUAGE plpgsql AS $b8$
DECLARE
    v_booking local_service.bookings%ROWTYPE;
    v_refundable BOOLEAN;
BEGIN
${predicate}
END;
$b8$;`;

const mutants = [
  ['M1 expired put back into the settled list', BASELINE.replace(
    `v_booking.status IN ('cancelled', 'no_show', 'completed')`,
    `v_booking.status IN ('cancelled', 'expired', 'no_show', 'completed')`)],
  ['M2 rejected used as a booking status', BASELINE.replace(
    `v_booking.status IN ('cancelled', 'no_show', 'completed')`,
    `v_booking.status IN ('cancelled', 'rejected', 'no_show', 'completed')`)],
  ['M3 the time test gated by booking status', BASELINE.replace(
    'OR v_booking.end_timestamptz < now()',
    `OR (v_booking.status = 'pending_review' AND v_booking.end_timestamptz < now())`)],
  ['M4 rejected added to the held-deposit list', BASELINE.replace(
    `v_booking.deposit_status IN ('submitted', 'verified')`,
    `v_booking.deposit_status IN ('submitted', 'verified', 'rejected')`)],
  ['M5 end <= now instead of end < now', BASELINE.replace(
    'v_booking.end_timestamptz < now()',
    'v_booking.end_timestamptz <= now()')],
  ['M6 the end-time disjunct removed entirely', BASELINE.replace(
    `        AND (
            v_booking.status IN ('cancelled', 'no_show', 'completed')
            OR v_booking.end_timestamptz < now()
        );`,
    `        AND v_booking.status IN ('cancelled', 'no_show', 'completed');`)],
  ['M7 the predicate assignment removed', wrap('    PERFORM 1;')],
];

const NOW = '2026-10-01T17:00:00+07:00';
const CASES = [
  { status: 'expired', depositStatus: 'verified', endTime: '2026-10-01T20:00:00+07:00', expected: false },
  { status: 'confirmed', depositStatus: 'verified', endTime: '2026-10-01T16:00:00+07:00', expected: true },
  { status: 'hold', depositStatus: 'verified', endTime: '2026-10-01T16:00:00+07:00', expected: true },
  { status: 'pending_review', depositStatus: 'verified', endTime: '2026-10-01T16:00:00+07:00', expected: true },
  { status: 'cancelled', depositStatus: 'rejected', endTime: '2026-10-01T20:00:00+07:00', expected: false },
  { status: 'completed', depositStatus: 'submitted', endTime: '2026-10-01T20:00:00+07:00', expected: true },
];

let caught = 0;
console.log('mutant                                              caught by');
for (const [name, mutantSql] of mutants) {
  const text = wrap(mutantSql);
  const reasons = [];
  try {
    const specText = specPredicateExpression(text);
    if (specText !== REAL) reasons.push('TEXT mismatch');
    const parsed = parseSqlPredicate(text);
    const caseFails = CASES.filter((entry) => evaluateSqlPredicate(parsed, entry, NOW) !== entry.expected);
    if (caseFails.length) reasons.push(`CASE mismatch (${caseFails.map((c) => c.status).join(',')})`);
  } catch (error) {
    reasons.push(`parse refused (${error.message.slice(0, 48)})`);
  }
  if (reasons.length) caught += 1;
  console.log(`${(reasons.length ? 'REFUSED' : 'ACCEPTED').padEnd(9)} ${name.padEnd(42)} ${reasons.join('; ') || '-- NOT CAUGHT --'}`);
}
console.log(`\nmutants: ${mutants.length}  refused: ${caught}`);
console.log(caught === mutants.length
  ? 'RESULT: the parity gate rejects every mutant (not vacuous)'
  : 'RESULT: the parity gate ACCEPTS a mutant - it is vacuous');
process.exit(caught === mutants.length ? 0 : 1);
