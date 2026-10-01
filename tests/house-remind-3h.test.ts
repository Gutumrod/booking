import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCustomerReminderText,
  REMINDER_EVENT_TYPE,
  REMINDER_LEAD_HOURS,
} from '../apps/booking-consumer/src/lib/customer-reminder-text.ts';

/**
 * Unit 6 — HOUSE-BK01-REMIND-3H (BK01 brief 25, Owner decision A-21).
 *
 * The Owner moved the single customer reminder from 24 hours before the
 * appointment to 3 hours, and the message must carry the shop, the date, the
 * time and the QUEUE CODE, in Thai and English.
 *
 * What is proven here: the app-side text and event identity. What is NOT: that
 * the database creates the row at T-3h, or that a reminder inside the 3-hour
 * window is refused — those are the SQL spec at the end of this branch and are
 * not applied by this unit.
 */

const read = (path: string) => readFileSync(path, 'utf8');

test('the reminder is identified as the 3-hour event, not the retired 24-hour one', () => {
  assert.equal(REMINDER_EVENT_TYPE, 'reminder_3h');
  assert.equal(REMINDER_LEAD_HOURS, 3);
  const source = read('apps/booking-consumer/src/lib/customer-reminder-text.ts');
  assert.match(source, /reminder_3h/);
  assert.doesNotMatch(source, /reminder_1h/);
});

test('the reminder text carries shop, date, time and the queue code in TH and EN', () => {
  const text = buildCustomerReminderText({
    shopName: 'ร้านตัดผมทดสอบ',
    bookingDate: '2026-10-02',
    startTime: '14:30:00',
    bookingCode: 'BK-1001',
  });
  const [th, en] = text.split('\n');
  assert.match(th, /ร้านตัดผมทดสอบ/);
  assert.match(th, /2026-10-02/);
  assert.match(th, /14:30/);
  assert.match(th, /BK-1001/);
  assert.match(en, /ร้านตัดผมทดสอบ/);
  assert.match(en, /2026-10-02/);
  assert.match(en, /14:30/);
  assert.match(en, /BK-1001/);
  // Short: two lines, no customer name, no amount, no slip wording.
  assert.equal(text.split('\n').length, 2);
  assert.doesNotMatch(text, /สลิป|slip|฿|amount|ยอด/);
});

test('a missing queue code prints a placeholder instead of dropping the line', () => {
  const text = buildCustomerReminderText({
    shopName: 'Shop',
    bookingDate: '2026-10-02',
    startTime: '09:00',
    bookingCode: null,
  });
  assert.match(text.split('\n')[0], /รหัสคิว -/);
  assert.match(text.split('\n')[1], /queue -/);
});

test('the reminder text names no lead time, so a legacy 24-hour row is not misdescribed', () => {
  // The same builder renders both `reminder_3h` and a legacy `reminder_24h` row.
  // The message therefore must not claim "3 hours", or such a row would tell the
  // customer something the row was not created under.
  const text = buildCustomerReminderText({
    shopName: 'Shop', bookingDate: '2026-10-02', startTime: '09:00', bookingCode: 'BK-1',
  });
  assert.doesNotMatch(text, /3 ชั่วโมง|3 hours|24 ชั่วโมง|24 hours/);
});

test('the dispatch route renders reminders through the shared builder, not an inline string', () => {
  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.match(route, /buildCustomerReminderText/);
  assert.match(route, /reminder_3h/);
  // The retired inline copy must be gone.
  assert.doesNotMatch(route, /`แจ้งเตือนคิวที่ \$\{context\.shop_name/);
});

test('the LINE binding card states the queue code and the 3-hour reminder in TH and EN', () => {
  const source = read('apps/booking-consumer/src/lib/line-flex-templates.ts');
  assert.match(source, /รหัสคิว: \$\{details\.bookingCode\}/);
  assert.match(source, /3 ชั่วโมง/);
  assert.match(source, /3 hours/);
  // The old promise said "before the appointment" with no lead time.
  assert.doesNotMatch(source, /ระบบจะส่งข้อความแจ้งเตือนก่อนเวลานัดหมาย',/);
});
