import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { depositCollectedTotal } from '../apps/booking-admin/src/lib/deposit-collected.ts';
import { REFUND_HELD_DEPOSIT_STATES } from '../apps/booking-admin/src/lib/refund-eligibility.ts';

/**
 * B8b — the "deposit collected" statistics card counted only `status = 'confirmed'`,
 * so the figure collapsed to a fraction the moment the shop pressed completed or
 * no_show (the money was still in the shop's account). AGY reproduced it; this file
 * reproduces it again independently and pins the corrected rule.
 *
 * The honest question for the card is "how much money have I taken in that I still
 * hold?", which is a deposit_state question, not an appointment-state question.
 */

type Row = { status: string; depositStatus: string; depositPrice: number };
const row = (status: string, depositStatus: string, depositPrice = 500): Row => ({
  status,
  depositStatus,
  depositPrice,
});

/** The pre-B8b formula, copied verbatim so the regression is visible in the test. */
const legacyFormula = (rows: Row[]) =>
  rows.reduce((sum, b) => sum + (b.status === 'confirmed' ? b.depositPrice : 0), 0);

test('reproduces B8b: the card collapsed the moment the shop marked the outcome', () => {
  const rows = [
    row('confirmed', 'verified'),
    row('completed', 'verified'),
    row('no_show', 'verified'),
  ];

  // The bug: only the confirmed row survived; ฿1,000 of held deposit vanished.
  assert.equal(legacyFormula(rows), 500);
  // The money the shop actually took in and still holds.
  assert.equal(depositCollectedTotal(rows), 1500);
});

test('cancellation does not erase a deposit the shop has not refunded', () => {
  // cancelled + verified = the shop still holds the money until B8 records refund.
  assert.equal(depositCollectedTotal([row('cancelled', 'verified')]), 500);
  assert.equal(depositCollectedTotal([row('expired', 'submitted')]), 500);
  assert.equal(depositCollectedTotal([row('pending_review', 'submitted')]), 500);
});

test('§5c-3: a rejected slip is NOT money the shop holds', () => {
  assert.equal(depositCollectedTotal([row('cancelled', 'rejected')]), 0);
  assert.equal(depositCollectedTotal([row('confirmed', 'rejected')]), 0);
  assert.equal(depositCollectedTotal([row('hold', 'rejected')]), 0);
});

test('B8: a recorded refund is subtracted from the collected total', () => {
  assert.equal(depositCollectedTotal([row('cancelled', 'refunded')]), 0);
  assert.equal(
    depositCollectedTotal([row('completed', 'verified'), row('cancelled', 'refunded')]),
    500,
    'the refunded row must drop out of the total',
  );
});

test('refuses rows that carry no received money', () => {
  // Refusal half — a formula that summed everything would fail here.
  assert.equal(depositCollectedTotal([row('hold', 'awaiting')]), 0);
  assert.equal(depositCollectedTotal([row('confirmed', 'not_required', 0)]), 0);
  assert.equal(depositCollectedTotal([row('cancelled', 'refunded')]), 0);
  assert.equal(depositCollectedTotal([row('cancelled', 'rejected')]), 0);
  assert.equal(depositCollectedTotal([]), 0);
});

test('the card and the refund rule cannot drift apart', () => {
  // Both features answer the same question — "is the shop holding this money?" —
  // so a state that counts as collected must also be refundable-visible.
  for (const state of ['submitted', 'verified'] as const) {
    assert.ok(
      REFUND_HELD_DEPOSIT_STATES.includes(state),
      `${state} counts as collected but the refund rule no longer sees it`,
    );
  }
  for (const state of ['awaiting', 'not_required', 'refunded', 'rejected'] as const) {
    assert.equal(
      REFUND_HELD_DEPOSIT_STATES.includes(state),
      false,
      `${state} must not read as held money`,
    );
  }
});

test('the dashboard card uses the corrected rule, not the appointment status', () => {
  const dashboard = readFileSync('apps/booking-admin/src/app/dashboard/page.tsx', 'utf8');
  assert.match(dashboard, /depositCollectedTotal\(bookings\)/);
  assert.doesNotMatch(
    dashboard,
    /depositCollected\s*=\s*bookings\.reduce\([^)]*status === 'confirmed'/,
    'the card must not go back to counting only confirmed bookings',
  );
});
