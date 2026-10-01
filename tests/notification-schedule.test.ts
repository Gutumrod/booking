import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bangkokParts,
  bangkokStamp,
  isMerchantQuietHour,
  nextBangkokHour,
  resolveMerchantSendTime,
  resolveSummaryRound,
  summaryInstantsForUtcDay,
  MERCHANT_QUIET_END_HOUR,
  MERCHANT_QUIET_START_HOUR,
  MERCHANT_SUMMARY_HOURS,
} from '../apps/booking-consumer/src/lib/notification-schedule.ts';

// 2026-10-01 is a Thursday; Thailand has no DST, so every expectation below is a
// fixed offset from UTC+7 and can be written by hand.
const utc = (iso: string) => new Date(iso);

test('Bangkok parts match Intl for Asia/Bangkok across a whole day', () => {
  // The constant offset in the module must agree with the platform's own idea of
  // Bangkok time, hour by hour, including across the UTC midnight wrap.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  for (let offsetHours = 0; offsetHours < 48; offsetHours += 1) {
    const instant = new Date(Date.UTC(2026, 9, 1, 0, 30) + offsetHours * 3600_000);
    const reference = fmt.format(instant).replace(',', '');
    const [datePart, timePart] = reference.split(' ');
    const [day, month, year] = datePart.split('/');
    const [hour, minute] = timePart.split(':');
    const parts = bangkokParts(instant);
    assert.equal(
      `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
      `${year}-${Number(month)}-${Number(day)} ${Number(hour) === 24 ? 0 : Number(hour)}:${Number(minute)}`,
      `Bangkok parts disagree with Intl at ${instant.toISOString()}`,
    );
  }
});

test('quiet hours are exactly 22:00-08:00 Bangkok', () => {
  assert.equal(isMerchantQuietHour(utc('2026-10-01T14:59:00Z')), false, '21:59 Bangkok is still open');
  assert.equal(isMerchantQuietHour(utc('2026-10-01T15:00:00Z')), true, '22:00 Bangkok starts the quiet window');
  assert.equal(isMerchantQuietHour(utc('2026-10-01T20:59:00Z')), true, '03:59 Bangkok is quiet');
  assert.equal(isMerchantQuietHour(utc('2026-10-02T00:59:00Z')), true, '07:59 Bangkok is quiet');
  assert.equal(isMerchantQuietHour(utc('2026-10-02T01:00:00Z')), false, '08:00 Bangkok is open again');
  assert.equal(MERCHANT_QUIET_START_HOUR, 22);
  assert.equal(MERCHANT_QUIET_END_HOUR, 8);
});

test('an immediate send inside quiet hours moves to the 09:00 round, not 22:00', () => {
  const duringQuiet = utc('2026-10-01T16:30:00Z'); // 23:30 Bangkok
  const scheduled = resolveMerchantSendTime(duringQuiet, 'immediate');
  assert.equal(scheduled.toISOString(), '2026-10-02T02:00:00.000Z', '09:00 Bangkok the next morning');
  assert.equal(bangkokStamp(scheduled), '2026-10-02 09:00');

  const earlyMorning = utc('2026-10-01T20:15:00Z'); // 03:15 Bangkok
  assert.equal(resolveMerchantSendTime(earlyMorning, 'immediate').toISOString(), '2026-10-02T02:00:00.000Z');

  const lateEvening = utc('2026-10-01T15:05:00Z'); // 22:05 Bangkok
  assert.equal(resolveMerchantSendTime(lateEvening, 'immediate').toISOString(), '2026-10-02T02:00:00.000Z');
});

test('an immediate send outside quiet hours goes now', () => {
  const open = utc('2026-10-01T09:00:00Z'); // 16:00 Bangkok
  assert.equal(resolveMerchantSendTime(open, 'immediate').getTime(), open.getTime());
  const morningOpen = utc('2026-10-02T01:00:00Z'); // 08:00 Bangkok
  assert.equal(resolveMerchantSendTime(morningOpen, 'immediate').getTime(), morningOpen.getTime());
});

test('daily summaries resolve to the two rounds and are never pushed into quiet hours', () => {
  assert.deepEqual(resolveSummaryRound(utc('2026-10-02T02:00:00Z')), { round: 'morning' });
  assert.deepEqual(resolveSummaryRound(utc('2026-10-02T10:00:00Z')), { round: 'afternoon' });
  assert.deepEqual(resolveSummaryRound(utc('2026-10-02T02:01:00Z')), { round: null });
  assert.deepEqual(resolveSummaryRound(utc('2026-10-02T10:01:00Z')), { round: null }, '17:01 Bangkok is not the round');

  for (const hour of MERCHANT_SUMMARY_HOURS) {
    const round = new Date(Date.UTC(2026, 9, 2, hour - 7, 0, 0));
    assert.equal(isMerchantQuietHour(round), false, `round ${hour}:00 Bangkok must not be inside the quiet window`);
    assert.equal(resolveMerchantSendTime(round, 'daily_summary').getTime(), round.getTime());
  }
});

test('nextBangkokHour is strictly future and never lands in the past', () => {
  const exactlyNine = utc('2026-10-02T02:00:00Z'); // 09:00 Bangkok exactly
  assert.equal(nextBangkokHour(exactlyNine, 9).toISOString(), '2026-10-03T02:00:00.000Z', 'a round already reached rolls to tomorrow');
  const beforeNine = utc('2026-10-02T01:59:59Z');
  assert.equal(nextBangkokHour(beforeNine, 9).toISOString(), '2026-10-02T02:00:00.000Z');
});

test('both summary instants for a UTC day are emitted in order and land on the two rounds', () => {
  const instants = summaryInstantsForUtcDay('2026-10-02');
  assert.deepEqual(instants, ['2026-10-02T02:00:00.000Z', '2026-10-02T10:00:00.000Z']);
  for (const instant of instants) {
    assert.notEqual(resolveSummaryRound(new Date(instant)).round, null);
  }
});
