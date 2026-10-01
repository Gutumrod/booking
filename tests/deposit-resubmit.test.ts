import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SLIP_SUBMISSIONS,
  resolveCustomerBookingScreen,
  resolveDepositResubmit,
} from '../apps/booking-consumer/src/lib/deposit-resubmit.ts';
import { buildCustomerNotificationText } from '../apps/booking-consumer/src/lib/customer-notify-text.ts';

/**
 * The controller's rule set for B4 (brief 23 section 3): a rejected customer may
 * re-upload only while the queue is still free, capped by the existing
 * `slip_submit_count`; once the slot is taken the customer is told to book again.
 *
 * "The queue is still free" is not redefined here. It is checked against the same
 * four conditions `local_service.authorize_deposit_slip_upload` already demands
 * before issuing an upload grant, so this resolver cannot promise an upload the
 * SQL would refuse.
 */

const NOW = new Date('2026-10-01T05:00:00Z');
const future = '2026-10-01T05:12:00Z';
const past = '2026-10-01T04:59:00Z';

test('a rejected slip on a live hold may be re-uploaded', () => {
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: 1, now: NOW }),
    { allowed: true },
  );
});

test('once the slot is taken the customer is told to book again, not to re-upload', () => {
  // status left `hold` -- somebody else holds the slot now.
  assert.deepEqual(
    resolveDepositResubmit({ status: 'pending_review', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
  assert.deepEqual(
    resolveDepositResubmit({ status: 'confirmed', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
  assert.deepEqual(
    resolveDepositResubmit({ status: 'cancelled', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
});

test('a hold whose window has closed is a taken slot, not a re-upload offer', () => {
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: past, slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: null, slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: 'not-a-date', slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
  // The boundary itself is already in the past.
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: '2026-10-01T05:00:00Z', slipSubmitCount: 1, now: NOW }),
    { allowed: false, reason: 'queue_taken' },
  );
});

test('the existing slip_submit_count is the cap', () => {
  for (let attempts = 0; attempts < MAX_SLIP_SUBMISSIONS; attempts += 1) {
    assert.deepEqual(
      resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: attempts, now: NOW }),
      { allowed: true },
      `attempt ${attempts} is still under the cap`,
    );
  }
  assert.deepEqual(
    resolveDepositResubmit({ status: 'hold', depositStatus: 'rejected', expiresAt: future, slipSubmitCount: MAX_SLIP_SUBMISSIONS, now: NOW }),
    { allowed: false, reason: 'attempts_exhausted' },
  );
  assert.equal(MAX_SLIP_SUBMISSIONS, 5, 'the cap is the number the notification policy already uses');
});

test('only a rejected slip gets a re-upload offer', () => {
  for (const depositStatus of ['awaiting', 'submitted', 'verified', 'refunded', 'not_required']) {
    assert.deepEqual(
      resolveDepositResubmit({ status: 'hold', depositStatus, expiresAt: future, slipSubmitCount: 1, now: NOW }),
      { allowed: false, reason: 'not_rejected' },
    );
  }
});

test('the screen a customer lands on follows the same decision', () => {
  const base = { expiresAt: future, slipSubmitCount: 0, now: NOW };
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'hold', depositStatus: 'rejected' }), 'rejected_resubmit');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'pending_review', depositStatus: 'rejected' }), 'rejected_queue_taken');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'hold', depositStatus: 'rejected', slipSubmitCount: 5 }), 'rejected_attempts_exhausted');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'pending_review', depositStatus: 'submitted' }), 'awaiting_review');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'confirmed', depositStatus: 'verified' }), 'confirmed');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'cancelled', depositStatus: 'awaiting' }), 'cancelled');
  assert.equal(resolveCustomerBookingScreen({ ...base, status: 'no_show', depositStatus: 'verified' }), 'other');
});

test('the four customer messages that already shipped are byte-identical', () => {
  // These strings are what customers receive today. B4 adds a rejection message;
  // it must not quietly rewrite the others.
  assert.equal(
    buildCustomerNotificationText({ eventType: 'booking_created', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-02', startTime: '09:00:00' }),
    'ยืนยันคิวที่ ร้านทดสอบ วันที่ 2026-10-02 เวลา 09:00',
  );
  assert.equal(
    buildCustomerNotificationText({ eventType: 'booking_cancelled', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-02', startTime: '09:00:00' }),
    'ยกเลิกคิวที่ ร้านทดสอบ แล้ว',
  );
  assert.equal(
    buildCustomerNotificationText({ eventType: 'booking_rescheduled', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-03', startTime: '14:30:00' }),
    'เลื่อนคิวเป็นวันที่ 2026-10-03 เวลา 14:30',
  );
  assert.equal(
    buildCustomerNotificationText({ eventType: 'reminder_24h', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-02', startTime: '09:00:00' }),
    'แจ้งเตือนคิวที่ ร้านทดสอบ วันที่ 2026-10-02 เวลา 09:00',
  );
  // An unknown/missing shop name keeps the legacy fallback wording.
  assert.equal(
    buildCustomerNotificationText({ eventType: 'reminder_24h', shopName: null, bookingDate: '2026-10-02', startTime: '09:00:00' }),
    'แจ้งเตือนคิวที่ ร้านค้า วันที่ 2026-10-02 เวลา 09:00',
  );
});

test('the rejection message is bilingual and differs with the re-upload rule', () => {
  const canResubmit = buildCustomerNotificationText({
    eventType: 'deposit_rejected', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-02', startTime: '09:00:00', canResubmit: true,
  });
  const cannotResubmit = buildCustomerNotificationText({
    eventType: 'deposit_rejected', shopName: 'ร้านทดสอบ', bookingDate: '2026-10-02', startTime: '09:00:00', canResubmit: false,
  });
  assert.match(canResubmit, /อัปโหลดสลิปใหม่/);
  assert.match(canResubmit, /EN:/);
  assert.match(cannotResubmit, /จองคิวใหม่/);
  assert.match(cannotResubmit, /EN:/);
  assert.notEqual(canResubmit, cannotResubmit);
});
