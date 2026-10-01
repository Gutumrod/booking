import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_EXPRESSION,
  CASES,
  DOCUMENTED_DIVERGENCES,
  RUNNER,
  normaliseSqlExpression,
  runParity,
  specPredicateExpression,
} from '../evidence/refund-predicate-parity.ts';

/**
 * B8 · H1 round 2 — the app and the SQL spec must carry ONE refund predicate.
 *
 * Codex failed round 2 on exactly this: `refund-eligibility.ts` released `expired`
 * before its appointment and hid `confirmed`/`hold` after theirs, while the SQL
 * spec said the opposite. The caretaker then ruled one formula (STATUS-HOUSE A-9
 * after round 2, item 1):
 *
 *   deposit_status IN ('submitted','verified')
 *   AND ( status IN ('cancelled','no_show','completed') OR end_timestamptz < now() )
 *
 * Parity is checked twice, both re-runnable:
 *   - TEXT: the executable `v_refundable := ...;` line in the spec, normalised,
 *     must equal the expression built from the app's exported constants.
 *   - CASES: one table, evaluated by the real TS rule and by an evaluator whose
 *     status lists are parsed out of the spec.
 *
 * The spec lives at evidence/b8-spec-v2-addendum-for-group5.sql on this branch —
 * the very revision ก้อน 5 receives. It is a spec, not a migration: nothing under
 * supabase/ is touched and no DDL is applied anywhere.
 */

test('the spec and the app express the same predicate, character for character', () => {
  assert.equal(specPredicateExpression(RUNNER.readSpec()), normaliseSqlExpression(CANONICAL_EXPRESSION));
  assert.equal(
    specPredicateExpression(RUNNER.readSpec()),
    "deposit_status IN ('submitted', 'verified') AND (status IN ('cancelled', 'no_show', 'completed') OR end_timestamptz < now())",
  );
});

test('the spec never mentions a booking status that the CHECK forbids, nor an expired-list release', () => {
  const spec = RUNNER.readSpec();
  // `rejected` may appear only as a deposit_status (the refused-slip shape), never
  // as one of the booking statuses in the settled list.
  const settled = spec.match(/status\s+IN\s*\(([^)]*)\)/g) ?? [];
  for (const clause of settled) {
    assert.doesNotMatch(clause, /'rejected'/);
    assert.doesNotMatch(clause, /'expired'/);
  }
  assert.match(spec, /deposit_status IN \('submitted', 'verified'\)/);
});

test('every §5c case agrees across the app, the spec and the caretaker decision', () => {
  const results = runParity();
  const failed = results.filter((row) => !row.ok).map((row) => `${row.id}: ts=${row.ts} spec=${row.spec} expected=${row.expected}`);
  assert.deepEqual(failed, []);
  assert.equal(results.length, CASES.length);
  assert.ok(results.length >= 16, 'the case table must cover the full §5c matrix');
});

test('the ONLY app-vs-spec divergence is the documented end-time derivation case', () => {
  // A divergence that is not on the declared list is a fresh H1-class defect and
  // must fail here, not be discovered by a reviewer.
  const diverging = runParity().filter((row) => !row.agree).map((row) => row.id);
  assert.deepEqual(diverging.sort(), [...DOCUMENTED_DIVERGENCES].sort());
});

test('the case table is not vacuous: it contains refusals on both axes', () => {
  const statuses = CASES.map((entry) => entry.status);
  assert.ok(statuses.includes('expired') && statuses.includes('confirmed') && statuses.includes('hold'));
  const refused = CASES.filter((entry) => entry.expected === false);
  assert.ok(refused.length >= 8, 'both refusal halves must be present');
  // An "always true" or "always false" implementation cannot satisfy the table.
  assert.ok(CASES.some((entry) => entry.expected === true));
});

test('the round-1 fixture that used a booking status of rejected is gone', () => {
  // `bookings` CHECK admits only hold/pending_review/confirmed/completed/
  // cancelled/no_show/expired (product_rules_v1.sql:43), so a `rejected` booking
  // status cannot persist. The persisted shape is cancelled/hold + deposit_status
  // 'rejected', and it must NOT open the button.
  assert.equal(CASES.some((entry) => entry.status === 'rejected'), false);
  const persistedRefusal = CASES.find((entry) => entry.id.includes('cancelled + deposit rejected'));
  assert.ok(persistedRefusal, 'the persisted refusal fixture must exist');
  assert.equal(persistedRefusal.expected, false);
});
