import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appointmentEndsAt,
  canRecordRefund,
  DEPOSIT_REFUND_RPC,
  DEPOSIT_REFUND_HISTORY_RPC,
  SETTLED_QUEUE_STATUSES,
  REFUND_HELD_DEPOSIT_STATES,
  type RefundCandidate,
} from '../apps/booking-admin/src/lib/refund-eligibility.ts';

/**
 * B8 — deposit refund is a RECORD, not a transfer.
 *
 * The shop's deposit lands in the shop's own PromptPay account; the platform
 * never moves money. These tests pin the two things that can silently rot:
 *   1. the eligibility rule, exactly as the caretaker decided it in brief 23
 *      §5c-3/§5c-4 ("appointment END < now", released queue, submitted/verified
 *      only, never a confirmed booking in the future);
 *   2. the honesty surface (the admin UI must say the system does not transfer).
 *
 * Both halves are exercised: the positive cases would pass a vacuous rule, so the
 * refusal cases are the non-vacuity gate. Every case runs against a plain TS
 * module — no database, no network.
 */

const read = (path: string) => readFileSync(path, 'utf8');

const SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const DASHBOARD = 'apps/booking-admin/src/app/dashboard/page.tsx';
const CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
] as const;

/** Functions owned by ก้อน 1. A refund RPC must never be one of these. */
const KON1_OWNED_RPCS = [
  'submit_deposit_slip',
  'create_booking_hold',
  'approve_booking_deposit',
  'reject_deposit_slip',
  'cancel_booking',
] as const;

const NOW = '2026-10-01T17:00:00+07:00'; // Fri 1 Oct 2026, 17:00 Bangkok
const END_PASSED = '2026-10-01T16:00:00+07:00'; // 14:00 + 120 min, already over
const END_FUTURE = '2026-10-01T20:00:00+07:00';
const END_TOMORROW = '2026-10-02T16:00:00+07:00';

const candidate = (
  status: string,
  depositStatus: string,
  endTime: string | null = END_PASSED,
  extra: Partial<RefundCandidate> = {},
): RefundCandidate => ({
  status,
  depositStatus: depositStatus as RefundCandidate['depositStatus'],
  date: '2026-10-01',
  time: '14:00',
  durationMinutes: 120,
  endTime,
  ...extra,
});

test('§5c-4 case 1: pending_review on the same day, appointment already ended -> offered', () => {
  // The caretaker's rule is end-of-appointment < now, NOT date < today. This case
  // (same calendar day, finished at 16:00, checked at 17:00) failed before the fix.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified'), NOW), true);
  assert.equal(canRecordRefund(candidate('pending_review', 'submitted'), NOW), true);
});

test('§5c-4 case 2: completed booking that still holds the deposit -> offered', () => {
  // completed was missing from the released set before the fix.
  assert.equal(canRecordRefund(candidate('completed', 'verified'), NOW), true);
  assert.equal(canRecordRefund(candidate('completed', 'submitted'), NOW), true);
});

test('§5c-4 case 3: confirmed booking in the future -> never offered', () => {
  assert.equal(canRecordRefund(candidate('confirmed', 'verified', END_TOMORROW), NOW), false);
  assert.equal(canRecordRefund(candidate('confirmed', 'submitted', END_FUTURE), NOW), false);
});

test('round 2: the time rule is NOT gated by booking status', () => {
  // Codex round 2 found the app hiding these while the SQL spec allowed them.
  assert.equal(canRecordRefund(candidate('confirmed', 'verified', END_PASSED), NOW), true);
  assert.equal(canRecordRefund(candidate('hold', 'submitted', END_PASSED), NOW), true);
  // ... and the reverse: an `expired` name is not a queue release by itself.
  assert.equal(canRecordRefund(candidate('expired', 'verified', END_FUTURE), NOW), false);
  assert.equal(canRecordRefund(candidate('expired', 'verified', END_PASSED), NOW), true);
});

test('every settled status that holds money is offered', () => {
  for (const status of SETTLED_QUEUE_STATUSES) {
    assert.equal(
      canRecordRefund(candidate(status, 'verified'), NOW),
      true,
      `${status} with a held deposit must be offered`,
    );
  }
  assert.deepEqual([...SETTLED_QUEUE_STATUSES].sort(), ['cancelled', 'completed', 'no_show']);
  // The two statuses that must NOT be queue releases in their own right.
  assert.equal(SETTLED_QUEUE_STATUSES.includes('expired'), false);
  assert.equal(SETTLED_QUEUE_STATUSES.includes('rejected'), false);
});

test('a queue that is still live is never offered', () => {
  assert.equal(canRecordRefund(candidate('hold', 'submitted', END_FUTURE), NOW), false);
  assert.equal(canRecordRefund(candidate('holding', 'verified', END_FUTURE), NOW), false);
  assert.equal(canRecordRefund(candidate('anything', 'verified', END_FUTURE), NOW), false);
});

test('pending_review whose appointment has NOT ended is never offered', () => {
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', END_FUTURE), NOW), false);
  // Boundary: end exactly now is not yet "past".
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', NOW), NOW), false);
});

test('§5c-3: only submitted / verified count as money the shop holds', () => {
  assert.deepEqual([...REFUND_HELD_DEPOSIT_STATES].sort(), ['submitted', 'verified']);
  for (const status of ['cancelled', 'expired', 'no_show', 'completed', 'rejected']) {
    assert.equal(canRecordRefund(candidate(status, 'rejected'), NOW), false, `${status} + rejected`);
    assert.equal(canRecordRefund(candidate(status, 'refunded'), NOW), false, `${status} + refunded`);
    assert.equal(canRecordRefund(candidate(status, 'awaiting'), NOW), false, `${status} + awaiting`);
    assert.equal(canRecordRefund(candidate(status, 'not_required'), NOW), false, `${status} + not_required`);
  }
});

test('round 2: the persisted refusal shape (cancelled/hold + deposit rejected) never opens', () => {
  // Codex round 2: the round-1 fixture used a booking status of `rejected`, which
  // the bookings CHECK forbids (product_rules_v1.sql:43). This is the shape a
  // refused slip actually persists as, and the money rule already excludes it.
  assert.equal(canRecordRefund(candidate('cancelled', 'rejected', END_PASSED), NOW), false);
  assert.equal(canRecordRefund(candidate('hold', 'rejected', END_PASSED), NOW), false);
});

test('an unreadable appointment end fails closed (action stays hidden)', () => {
  // A server value that is present but unparseable is a contradiction: refuse.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', 'nonsense'), NOW), false);
  assert.equal(
    canRecordRefund({ status: 'pending_review', depositStatus: 'verified', date: '2026-10-01' }, NOW),
    false,
    'no end time at all must not be treated as over',
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', null, { time: '25:99' }), NOW),
    false,
    'a malformed start time must not be treated as over',
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', null, { durationMinutes: null }), NOW),
    false,
    'no duration and no end time must not be treated as over',
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', null, { date: 'not-a-date' }), NOW),
    false,
    'an unparseable date must not be treated as over',
  );
  // A blank server value is absent, not contradictory: derive from the timeline.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', ''), NOW), true);
});

test('without a server end time the rule derives it from date + start + duration', () => {
  const derived = appointmentEndsAt({ date: '2026-10-01', time: '14:00', durationMinutes: 120 }, 'Asia/Bangkok');
  assert.equal(derived, '2026-10-01T09:00:00.000Z'); // 16:00 Bangkok == 09:00Z
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', null), NOW), true);
  // 18:00 start + 120 min = 20:00, still ahead of 17:00 -> hidden.
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', null, { time: '18:00' }), NOW),
    false,
  );
  // An appointment running past midnight rolls into the next day (23:30+90min =
  // 01:00 on 2026-10-02 in Bangkok == 18:00Z on 2026-10-01).
  assert.equal(
    appointmentEndsAt({ date: '2026-10-01', time: '23:30', durationMinutes: 90 }, 'Asia/Bangkok'),
    '2026-10-01T18:00:00.000Z',
  );
});

test('a server end time wins over the derived one', () => {
  const booking = { date: '2026-10-01', time: '14:00', durationMinutes: 120, endTime: '2026-10-01T18:00:00+07:00' };
  assert.equal(appointmentEndsAt(booking, 'Asia/Bangkok'), '2026-10-01T11:00:00.000Z');
});

test('the refund RPC is a new function, not one owned by ก้อน 1', () => {
  assert.equal(DEPOSIT_REFUND_RPC, 'record_deposit_refund');
  assert.equal(DEPOSIT_REFUND_HISTORY_RPC, 'get_deposit_refund_history');
  for (const owned of KON1_OWNED_RPCS) {
    assert.notEqual(DEPOSIT_REFUND_RPC, owned, 'B8 must not claim a ก้อน 1 function');
    assert.notEqual(DEPOSIT_REFUND_HISTORY_RPC, owned, 'B8 must not claim a ก้อน 1 function');
  }
});

test('the admin service records a refund and reads its audit trail', () => {
  const service = read(SERVICE);
  assert.match(service, /export async function recordBookingDepositRefund\(/);
  assert.match(service, /export async function fetchDepositRefundHistory\(/);
  assert.match(service, /rpc\(DEPOSIT_REFUND_RPC/);
  assert.match(service, /rpc\(DEPOSIT_REFUND_HISTORY_RPC/);
  // The refund path must never borrow an approval/rejection RPC.
  const refundBlock = service.slice(service.indexOf('recordBookingDepositRefund'));
  assert.doesNotMatch(refundBlock.slice(0, 900), /approve_booking_deposit|reject_deposit_slip/);
});

test('the booking read carries the timeline the rule needs (end + duration)', () => {
  const service = read(SERVICE);
  assert.match(service, /end_timestamptz/);
  assert.match(service, /services \( name, duration_minutes \)/);
  assert.match(service, /endTime: booking\.end_timestamptz/);
  assert.match(service, /durationMinutes: \(service as RelationService \| null\)\?\.duration_minutes \?\? null/);
});

test('the dashboard offers the refund action only through the eligibility rule', () => {
  const dashboard = read(DASHBOARD);
  assert.match(dashboard, /canRecordRefund\(/);
  assert.match(dashboard, /handleRecordRefund/);
  assert.match(dashboard, /t\('refundDisclosure'\)/);
  assert.match(dashboard, /recordBookingDepositRefund\(/);
});

test('the dashboard never claims the system sends the money back', () => {
  const dashboard = read(DASHBOARD);
  assert.doesNotMatch(dashboard, /ระบบโอนคืน|system refunds|we refund the customer|โอนเงินคืนอัตโนมัติ/i);
});

test('both catalogues carry the refund disclosure and the actor trail wording', () => {
  const th = JSON.parse(read(CATALOGUES[0])) as { dashboard: Record<string, string> };
  const en = JSON.parse(read(CATALOGUES[1])) as { dashboard: Record<string, string> };

  for (const messages of [th, en]) {
    assert.equal(typeof messages.dashboard.refundDisclosure, 'string');
    assert.equal(typeof messages.dashboard.refundReferenceLabel, 'string');
    assert.equal(typeof messages.dashboard.refundAction, 'string');
    assert.equal(typeof messages.dashboard.refundAuditTitle, 'string');
    assert.equal(typeof messages.dashboard.refundAuditUnavailable, 'string');
  }

  // The disclosure must be explicit in each language: no silent transfer claim.
  assert.match(th.dashboard.refundDisclosure, /ระบบไม่ได้โอนเงินให้/);
  assert.match(th.dashboard.refundDisclosure, /โอนคืน.*เอง|คุณโอนคืน/);
  assert.match(en.dashboard.refundDisclosure, /does not transfer/i);
  assert.match(en.dashboard.refundDisclosure, /yourself|your own/i);

  // Key parity: the i18n suite compares the two key trees, keep them identical.
  assert.deepEqual(Object.keys(en.dashboard).sort(), Object.keys(th.dashboard).sort());
});
