/**
 * BK01 P0 / H5 — the refund UI (round 2 of unit HOUSE-BK01-P0-APP).
 *
 * Brief 28 §4 H5 asked for "UI บันทึกคืนเงินรวมกรณีสลิปถูกปฏิเสธ + ช่องหลักฐานแนบ
 * ตาม CONTRACT", and the caretaker closed the open question in room 2026-10-01
 * (lines 966–970 and 1004):
 *
 *   - the mandatory evidence is the TEXTUAL transfer reference — build it now;
 *   - FILE attachments are HOLD (no new storage scope exists, and the customer's
 *     slip-upload scope must never be reused for merchant evidence).
 *
 * So this file pins three things:
 *
 *  1. THE RULE MIRRORS THE SQL, READ FROM THE SQL ITSELF. The P0 migration is on
 *     disk in the sibling worktree; the eligibility rule here must agree with the
 *     predicate `record_deposit_refund` actually enforces. A rule that drifts from
 *     the guard produces a button that is offered and then refused — the shop
 *     believes the click worked while the row does not change.
 *
 *  2. THE REFERENCE IS MANDATORY AND THE FORM CANNOT UPLOAD. A refund with no
 *     transfer reference is not evidence; a file input would invent an
 *     unauthorised storage scope.
 *
 *  3. THE DISCLOSURE IS HONEST IN BOTH LANGUAGES. The platform holds no money and
 *     never moves any — the copy may never imply otherwise.
 *
 * Non-vacuity: the refusal cases are the gate. `tests/house-pack-notify-mutations.mjs`
 * additionally proves these assertions fail when the behaviour is removed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appointmentEndsAt,
  canRecordRefund,
  canRecordRefundForDeposit,
  holdsDepositMoney,
  REFUND_HELD_DEPOSIT_STATES,
  REFUNDABLE_DEPOSIT_STATES,
  REFUND_REFERENCE_MAX_LENGTH,
  SETTLED_QUEUE_STATUSES,
  DEPOSIT_REFUND_RPC,
  DEPOSIT_REFUND_HISTORY_RPC,
  type RefundCandidate,
} from '../apps/booking-admin/src/lib/refund-eligibility.ts';

const read = (path: string) => readFileSync(path, 'utf8');

const SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const DASHBOARD = 'apps/booking-admin/src/app/dashboard/page.tsx';
const CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
] as const;

/** The migration that carries the predicate this UI must agree with. */
const P0_SQL =
  'D:/AI-Workspace/runtime/worktrees/bk01-p0-sql-20261002/supabase/bk01-migrations/20261002120000_bk01_council_p0.sql';

const NOW = '2026-10-01T17:00:00+07:00'; // Fri 1 Oct 2026, 17:00 Bangkok
const END_PASSED = '2026-10-01T16:00:00+07:00'; // 14:00 + 120 min, already over
const END_FUTURE = '2026-10-01T20:00:00+07:00';
const END_TOMORROW = '2026-10-02T16:00:00+07:00';
const RELEASED = '2026-10-01T16:30:00+07:00';

const candidate = (
  status: string,
  depositStatus: string,
  extra: Partial<RefundCandidate> = {},
): RefundCandidate => ({
  status,
  depositStatus: depositStatus as RefundCandidate['depositStatus'],
  date: '2026-10-01',
  time: '14:00',
  durationMinutes: 120,
  endTime: END_PASSED,
  queueReleasedAt: null,
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. The rule mirrors the SQL predicate — parsed out of the migration, not restated
// ---------------------------------------------------------------------------

test('the app rule agrees with the predicate record_deposit_refund enforces', () => {
  const sql = read(P0_SQL);

  // The role gate and the "already refunded" refusal.
  assert.match(sql, /deposit_status='refunded' THEN RAISE EXCEPTION 'Deposit already recorded as refunded'/);
  assert.match(sql, /has_shop_role\(v_booking\.shop_id,ARRAY\['owner','admin'\]::text\[\]\)/);

  // The refundable deposit states, exactly as the SQL writes them.
  const states = sql.match(/deposit_status NOT IN \(([^)]*)\)/);
  assert.ok(states, 'the SQL must refuse a deposit that holds no money');
  const sqlStates = states[1].split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(sqlStates, ['submitted', 'verified', 'rejected']);

  // The REFUND rule set must BE the SQL's set, read one line above — including
  // `rejected`. A rule that dropped `rejected` would offer nothing for a refused
  // slip the database would have accepted.
  assert.deepEqual([...REFUNDABLE_DEPOSIT_STATES], sqlStates);
  assert.equal(canRecordRefundForDeposit('rejected'), true);

  // The app deliberately treats only submitted/verified as MONEY THE SHOP HOLDS —
  // `rejected` is accepted by the SQL (a refused slip can still need money back)
  // but it is not a deposit the shop took in, so it must never inflate the total
  // nor open the button on its own.
  assert.deepEqual([...REFUND_HELD_DEPOSIT_STATES].sort(), ['submitted', 'verified']);
  assert.equal(holdsDepositMoney('rejected'), false);

  // The three ways a queue is settled — statuses, a released queue, a passed end.
  assert.match(
    sql,
    /status IN \('cancelled','no_show','completed'\) OR \(v_booking\.queue_released_at IS NOT NULL AND v_booking\.queue_released_at<now\(\)\) OR \(v_booking\.end_timestamptz IS NOT NULL AND v_booking\.end_timestamptz<now\(\)\)/,
  );
  assert.deepEqual([...SETTLED_QUEUE_STATUSES].sort(), ['cancelled', 'completed', 'no_show']);

  // The reference rule — and the length is READ from the SQL so the two cannot drift.
  const lengthRule = sql.match(/length\(v_reference\)>(\d+)/);
  assert.ok(lengthRule, 'the SQL must bound the reference length');
  assert.equal(Number(lengthRule[1]), REFUND_REFERENCE_MAX_LENGTH);
  assert.match(sql, /Refund reference is required/);
});

test('the RPC names are the CONTRACT ones — no new function is invented', () => {
  assert.equal(DEPOSIT_REFUND_RPC, 'record_deposit_refund');
  assert.equal(DEPOSIT_REFUND_HISTORY_RPC, 'get_deposit_refund_history');
  const sql = read(P0_SQL);
  assert.match(sql, /CREATE OR REPLACE FUNCTION local_service\.record_deposit_refund\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION local_service\.get_deposit_refund_history\(/);
});

// ---------------------------------------------------------------------------
// 2. The rule's positive direction
// ---------------------------------------------------------------------------

test('a settled status holding money is offered', () => {
  for (const status of SETTLED_QUEUE_STATUSES) {
    assert.equal(canRecordRefund(candidate(status, 'submitted'), NOW), true, `${status} + submitted`);
    assert.equal(canRecordRefund(candidate(status, 'verified'), NOW), true, `${status} + verified`);
  }
});

test('a live queue is offered once the appointment END has passed, by status or by end time', () => {
  // Same-day, finished at 16:00, checked at 17:00 — end-of-appointment < now, not
  // "date < today". This is the difference between one and two appointments today.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified'), NOW), true);
  assert.equal(canRecordRefund(candidate('confirmed', 'verified'), NOW), true);
  assert.equal(canRecordRefund(candidate('hold', 'submitted'), NOW), true);
});

test('a released queue is offered even when the end time is still in the future', () => {
  // The SQL honours `queue_released_at` as its own disjunct; a rule that only looked
  // at end_timestamptz would hide an action the database would have allowed.
  assert.equal(
    canRecordRefund(candidate('pending_review', 'submitted', { endTime: END_FUTURE, queueReleasedAt: RELEASED }), NOW),
    true,
  );
  // A release that has not happened yet is not a release.
  assert.equal(
    canRecordRefund(
      candidate('pending_review', 'submitted', { endTime: END_FUTURE, queueReleasedAt: '2026-10-01T18:00:00+07:00' }),
      NOW,
    ),
    false,
  );
  // An unreadable release value is not evidence of one.
  assert.equal(
    canRecordRefund(candidate('pending_review', 'submitted', { endTime: END_FUTURE, queueReleasedAt: 'nonsense' }), NOW),
    false,
  );
});

test('without a server end time the rule derives it from date + start + duration', () => {
  assert.equal(
    appointmentEndsAt({ date: '2026-10-01', time: '14:00', durationMinutes: 120 }, 'Asia/Bangkok'),
    '2026-10-01T09:00:00.000Z', // 16:00 Bangkok == 09:00Z
  );
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', { endTime: null }), NOW), true);
  // 18:00 start + 120 min = 20:00, still ahead of 17:00 -> hidden.
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', { endTime: null, time: '18:00' }), NOW),
    false,
  );
});

// ---------------------------------------------------------------------------
// 3. The rule's refusal direction — the non-vacuity gate
// ---------------------------------------------------------------------------

test('a deposit the shop is not holding is never offered', () => {
  for (const status of ['cancelled', 'no_show', 'completed', 'expired', 'hold']) {
    // `rejected` is deliberately ABSENT from this list: the SQL accepts a refund
    // for a refused slip (it is in REFUNDABLE_DEPOSIT_STATES) while it is NOT money
    // the shop holds — the two questions are proven separately below.
    for (const depositStatus of ['refunded', 'awaiting', 'not_required']) {
      assert.equal(
        canRecordRefund(candidate(status, depositStatus), NOW),
        false,
        `${status} + ${depositStatus} must stay closed`,
      );
    }
  }
});

test('a REJECTED slip is refundable on a settled queue — refused money can still need sending back', () => {
  // The corrected rule: the SQL admits `submitted`, `verified` AND `rejected`, so
  // the dashboard must offer the action on all three. `rejected` is not money the
  // shop holds (holdsDepositMoney above), but it is still a deposit the database
  // will let a refund be recorded against — two questions, two answers.
  for (const status of SETTLED_QUEUE_STATUSES) {
    assert.equal(canRecordRefund(candidate(status, 'rejected'), NOW), true, `${status} + rejected`);
  }
  // And through the time disjunct, not only through a settled status name.
  assert.equal(canRecordRefund(candidate('pending_review', 'rejected'), NOW), true);
  assert.equal(
    canRecordRefund(candidate('pending_review', 'rejected', { endTime: END_FUTURE, queueReleasedAt: RELEASED }), NOW),
    true,
  );
  // The refusal direction still holds for a slip the database does NOT admit, and
  // for a `rejected` slip whose appointment has not finished yet.
  assert.equal(canRecordRefund(candidate('pending_review', 'rejected', { endTime: END_FUTURE }), NOW), false);
  assert.equal(canRecordRefundForDeposit('awaiting'), false);
  assert.equal(canRecordRefundForDeposit('not_required'), false);
});

test('a refunded deposit never reopens, and a future appointment is never offered', () => {
  assert.equal(canRecordRefund(candidate('completed', 'refunded'), NOW), false);
  assert.equal(canRecordRefund(candidate('confirmed', 'verified', { endTime: END_TOMORROW }), NOW), false);
  assert.equal(canRecordRefund(candidate('expired', 'verified', { endTime: END_FUTURE }), NOW), false);
});

test('an unreadable timeline fails closed', () => {
  // A server value that is present but unparseable is a contradiction: refuse.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', { endTime: 'nonsense' }), NOW), false);
  // Nothing to reason from at all.
  assert.equal(
    canRecordRefund({ status: 'pending_review', depositStatus: 'verified', date: '2026-10-01' }, NOW),
    false,
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', { endTime: null, time: '25:99' }), NOW),
    false,
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', { endTime: null, durationMinutes: null }), NOW),
    false,
  );
  assert.equal(
    canRecordRefund(candidate('pending_review', 'verified', { endTime: null, date: 'not-a-date' }), NOW),
    false,
  );
  // An unreadable `now` is not "over" either.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified'), 'not-a-clock'), false);
  // A blank server value is absent, not contradictory: derive from the timeline.
  assert.equal(canRecordRefund(candidate('pending_review', 'verified', { endTime: '' }), NOW), true);
});

// ---------------------------------------------------------------------------
// 4. The form: mandatory textual reference, no upload, owner/admin only
// ---------------------------------------------------------------------------

test('the service writes the refund and reads its history through the CONTRACT RPCs', () => {
  const service = read(SERVICE);
  assert.match(service, /export async function recordBookingDepositRefund\(/);
  assert.match(service, /export async function fetchDepositRefundHistory\(/);
  assert.match(service, /rpc\(DEPOSIT_REFUND_RPC, \{/);
  assert.match(service, /rpc\(DEPOSIT_REFUND_HISTORY_RPC, \{/);
  // The three named arguments, with the reference sent as given — the VALUE is
  // asserted, not merely the key: a call that keeps `p_refund_reference:` but sends
  // undefined would still satisfy a shape-only check while writing no evidence.
  const refundBlock = service.slice(service.indexOf('export async function recordBookingDepositRefund('));
  const call = refundBlock.slice(0, refundBlock.indexOf('});'));
  for (const arg of ['p_booking_id:', 'p_refund_reference:', 'p_note:']) {
    assert.ok(call.includes(arg), `${arg} is part of the CONTRACT signature`);
  }
  assert.match(call, /p_booking_id: bookingId,/);
  assert.match(call, /p_refund_reference: reference,/);
});

test('the reference field is mandatory, bounded by the shared constant, and never a file', () => {
  const dashboard = read(DASHBOARD);
  const modal = dashboard.slice(dashboard.indexOf('H5/G23 RECORD-A-REFUND MODAL'));
  assert.ok(modal.length > 100, 'the refund modal must be present');

  // The label is the caretaker's own wording: the shop's transfer reference, typed.
  assert.match(modal, /t\('refundReferenceLabel'\)/);
  assert.match(modal, /id="refund-reference"/);
  assert.match(modal, /maxLength=\{REFUND_REFERENCE_MAX_LENGTH\}/, 'the bound must come from the rule module, not a literal');
  assert.match(modal, /required/, 'the field is mandatory');
  assert.doesNotMatch(modal, /maxLength=\{120\}/, 'a hard-coded 120 would drift from the SQL silently');

  // The submit control is disabled until a reference exists, and the handler refuses
  // without one — the RPC would refuse too, but the shop should never be told "no".
  assert.match(modal, /disabled=\{!refundReference\.trim\(\) \|\| mutatingBookingId === refundBookingTarget\.id\}/);
  assert.match(dashboard, /if \(!tenantSnapshotReady \|\| shopRole === 'staff' \|\| !refundBookingTarget \|\| !refundReference\.trim\(\)\) return;/);
  assert.match(dashboard, /recordBookingDepositRefund\(refundBookingTarget\.id, refundReference\.trim\(\), refundNote\)/);

  // No upload path of any kind, and no reuse of the customer's slip scope.
  assert.doesNotMatch(modal, /type="file"|createSignedUploadUrl|\.upload\(|FormData/);
  assert.doesNotMatch(modal, /deposit-slips/);
});

test('the action is never offered to staff and only through the rule', () => {
  const dashboard = read(DASHBOARD);
  // The button is gated by the rule AND by the role, in that order of clauses.
  assert.match(dashboard, /shopRole !== 'staff' && b\.depositStatus !== 'refunded' && canRecordRefund\(\{/);
  assert.match(dashboard, /queueReleasedAt: b\.queueReleasedAt/);
  // The data the rule needs must actually be read from the server.
  const service = read(SERVICE);
  assert.match(service, /queue_released_at,/);
  assert.match(service, /services \( name, duration_minutes \)/);
  assert.match(service, /queueReleasedAt: booking\.queue_released_at \?\? null/);
});

// ---------------------------------------------------------------------------
// 5. The copy: honest in both languages, key parity preserved
// ---------------------------------------------------------------------------

test('both catalogues carry the refund copy with identical key trees', () => {
  const th = JSON.parse(read(CATALOGUES[0])) as { dashboard: Record<string, string> };
  const en = JSON.parse(read(CATALOGUES[1])) as { dashboard: Record<string, string> };

  const required = [
    'refundAction', 'refundActionHint', 'refundTitle', 'refundDepositAmount',
    'refundDisclosure', 'refundReferenceLabel', 'refundReferencePlaceholder',
    'refundReferenceRequired', 'refundNoteLabel', 'refundNotePlaceholder',
    'refundConfirm', 'refundRecording', 'refundCancel', 'refundFailed',
    'refundAuditTitle', 'refundAuditEmpty', 'refundAuditUnavailable',
  ];
  for (const key of required) {
    assert.equal(typeof th.dashboard[key], 'string', `th.json is missing ${key}`);
    assert.equal(typeof en.dashboard[key], 'string', `en.json is missing ${key}`);
  }
  assert.deepEqual(Object.keys(en.dashboard).sort(), Object.keys(th.dashboard).sort());
});

test('the disclosure never claims the platform transfers the money', () => {
  const th = JSON.parse(read(CATALOGUES[0])) as { dashboard: Record<string, string> };
  const en = JSON.parse(read(CATALOGUES[1])) as { dashboard: Record<string, string> };

  assert.match(th.dashboard.refundDisclosure, /ระบบไม่ได้โอนเงินให้/);
  assert.match(th.dashboard.refundDisclosure, /โอนคืน.*เอง/);
  assert.match(en.dashboard.refundDisclosure, /does not transfer/i);
  assert.match(en.dashboard.refundDisclosure, /yourself|your own/i);
  // The reference wording must say the shop fills it in — the system cannot know it.
  assert.match(th.dashboard.refundReferenceLabel, /ร้านกรอกเอง/);
  assert.match(en.dashboard.refundReferenceLabel, /your/i);

  const dashboard = read(DASHBOARD);
  assert.doesNotMatch(dashboard, /ระบบโอนคืน|system refunds|we refund the customer|โอนเงินคืนอัตโนมัติ/i);
});
