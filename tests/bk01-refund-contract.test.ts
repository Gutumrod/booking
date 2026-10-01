import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRecordRefund,
  DEPOSIT_REFUND_RPC,
  DEPOSIT_REFUND_HISTORY_RPC,
  REFUND_HELD_DEPOSIT_STATES,
} from '../apps/booking-admin/src/lib/refund-eligibility.ts';

/**
 * B8 — deposit refund is a RECORD, not a transfer.
 *
 * The shop's deposit lands in the shop's own PromptPay account; the platform
 * never moves money. These tests pin the two things that can silently rot:
 *   1. the eligibility rule (who the shop is allowed to mark as refunded);
 *   2. the honesty surface (the admin UI must say the system does not transfer).
 *
 * The rule is exercised as a pure function so the gate fails without a database.
 * The refusal cases are the non-vacuity half: a rule that answered `true` for
 * everything would pass the positive cases and fail these.
 */

const read = (path: string) => readFileSync(path, 'utf8');

const SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const DASHBOARD = 'apps/booking-admin/src/app/dashboard/page.tsx';
const CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
] as const;

/** Functions owned by B1/B2 (ก้อน 1). A refund RPC must never be one of these. */
const KON1_OWNED_RPCS = [
  'submit_deposit_slip',
  'create_booking_hold',
  'approve_booking_deposit',
  'reject_deposit_slip',
  'cancel_booking',
] as const;

type RefundCandidate = { status: string; depositStatus: string; date: string };
const candidate = (status: string, depositStatus: string, date = '2026-10-01'): RefundCandidate => ({
  status,
  depositStatus,
  date,
});

test('a released booking that holds money can be marked refunded', () => {
  // The three ways a queue stops without the appointment being fulfilled.
  assert.equal(canRecordRefund(candidate('cancelled', 'verified'), '2026-10-05'), true);
  assert.equal(canRecordRefund(candidate('expired', 'submitted'), '2026-10-05'), true);
  assert.equal(canRecordRefund(candidate('no_show', 'rejected'), '2026-10-05'), true);
});

test('an overdue undecided booking (ก้อน 1 leftover) can be marked refunded', () => {
  // A-20: items the shop never decided on after the appointment day stay open
  // for the shop to settle. Recording the refund is the shop's move, never the
  // system's — the rule only exposes the action.
  assert.equal(canRecordRefund(candidate('pending_review', 'submitted', '2026-09-30'), '2026-10-01'), true);
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', '2026-09-01'), '2026-10-01'), true);
});

test('refuses every case where no money is held or the queue is still live', () => {
  // Refusal half — a vacuous rule (`return true`) fails here.
  assert.deepEqual(REFUND_HELD_DEPOSIT_STATES.includes('awaiting' as never), false);
  assert.equal(canRecordRefund(candidate('cancelled', 'awaiting'), '2026-10-05'), false);
  assert.equal(canRecordRefund(candidate('cancelled', 'not_required'), '2026-10-05'), false);
  assert.equal(canRecordRefund(candidate('cancelled', 'refunded'), '2026-10-05'), false);
  assert.equal(canRecordRefund(candidate('hold', 'submitted'), '2026-10-05'), false);
  assert.equal(canRecordRefund(candidate('confirmed', 'verified'), '2026-10-05'), false);
  assert.equal(canRecordRefund(candidate('completed', 'verified'), '2026-10-05'), false);
});

test('an undecided booking keeps the queue until the appointment day has passed', () => {
  // Same day is NOT overdue: A-20 says "พ้นวันนัด" (past the appointment day).
  assert.equal(canRecordRefund(candidate('pending_review', 'submitted', '2026-10-02'), '2026-10-01'), false);
  assert.equal(canRecordRefund(candidate('pending_review', 'submitted', '2026-10-01'), '2026-10-01'), false);
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

test('the dashboard offers the refund action only through the eligibility rule', () => {
  const dashboard = read(DASHBOARD);
  assert.match(dashboard, /canRecordRefund\(/);
  assert.match(dashboard, /handleRecordRefund/);
  assert.match(dashboard, /t\('refundDisclosure'\)/);
  assert.match(dashboard, /recordBookingDepositRefund\(/);
});

test('the dashboard never claims the system sends the money back', () => {
  const dashboard = read(DASHBOARD);
  // A statement that the platform transfers the refund would be false.
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
