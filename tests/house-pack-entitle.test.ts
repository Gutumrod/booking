import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PLAN_NOTIFICATION_ENTITLEMENTS,
  TRIAL_ENTITLEMENT_PLAN,
  entitlementsForPlan,
  pushEntitlementColumn,
  resolveEffectivePlan,
} from '../apps/booking-consumer/src/lib/notification-entitlement.ts';
import {
  bangkokMonthKey,
  countsAgainstPushCap,
  resolvePushCapDecision,
  METERED_PUSH_EVENTS,
  UNMETERED_EVENTS,
} from '../apps/booking-consumer/src/lib/notification-push-budget.ts';

/**
 * Unit 7 item 1 + 2 — HOUSE-BK01-PACK-ENTITLE (BK01 brief 25, Owner decision A-21).
 *
 * Item 1: the per-plan table. Item 2: the per-shop monthly push cap, counted over
 * the Thai calendar month, with the binding reply excluded.
 *
 * What is proven here: the app-side decision and its boundary cases. What is NOT:
 * that the database column has the same values — the migration is a spec handed to
 * the controller and is not applied by this unit.
 */

const read = (path: string) => readFileSync(path, 'utf8');

// ---------------------------------------------------------------------------
// Item 1 — the per-plan table
// ---------------------------------------------------------------------------

test('the locked per-plan table matches A-21 row for row', () => {
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.free, {
    customer_reminder_push: true,
    customer_slip_decision_push: false,
    shop_email_slip: false,
    shop_email_booking: false,
    monthly_push_cap: 50,
  });
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.basic_490, {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: false,
    monthly_push_cap: 600,
  });
  assert.deepEqual(PLAN_NOTIFICATION_ENTITLEMENTS.pro_990, {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: true,
    monthly_push_cap: 1500,
  });
});

test('the trial carries the Basic entitlements, not a row of its own', () => {
  // A-21: "ทดลอง 14 วัน (สิทธิ์เท่า Basic)", through the existing `bk01_effective_plan`.
  assert.equal(TRIAL_ENTITLEMENT_PLAN, 'basic_490');
  assert.deepEqual(entitlementsForPlan(TRIAL_ENTITLEMENT_PLAN), PLAN_NOTIFICATION_ENTITLEMENTS.basic_490);

  const now = new Date('2026-10-01T06:00:00Z');
  assert.equal(resolveEffectivePlan({
    plan: 'basic_490', status: 'trialing',
    currentPeriodEnd: '2026-10-10T00:00:00Z', trialEndsAt: null, now,
  }), 'basic_490');

  // An expired trial falls back to FREE, which is the entitlement-minimal plan.
  assert.equal(resolveEffectivePlan({
    plan: 'basic_490', status: 'trialing',
    currentPeriodEnd: '2026-09-30T00:00:00Z', trialEndsAt: null, now,
  }), 'free');
});

test('an unknown plan or event fails closed instead of granting an entitlement', () => {
  assert.equal(entitlementsForPlan('free_trial'), null);
  assert.equal(entitlementsForPlan(null), null);
  assert.equal(entitlementsForPlan('enterprise'), null);
  assert.equal(pushEntitlementColumn('booking_created'), null);
  assert.equal(pushEntitlementColumn('whatever_new_event'), null);
});

test('each customer push event maps to the entitlement column A-21 names', () => {
  assert.equal(pushEntitlementColumn('reminder_3h'), 'customer_reminder_push');
  // A legacy row created before the 3-hour move keeps its pack entitlement.
  assert.equal(pushEntitlementColumn('reminder_24h'), 'customer_reminder_push');
  assert.equal(pushEntitlementColumn('deposit_rejected'), 'customer_slip_decision_push');
});

test('the route reads the entitlement from the database first and the mirror only as fallback', () => {
  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.match(route, /entitlementsForPlan/);
  assert.match(route, /customer_reminder_push/);
  assert.match(route, /customer_slip_decision_push/);
  // Over the pack is a suppression with a recorded reason, never a customer error.
  assert.match(route, /push_not_in_pack/);
});

// ---------------------------------------------------------------------------
// Item 2 — the per-shop monthly push cap
// ---------------------------------------------------------------------------

test('an unreadable count does NOT mute the shop — the cost guard reports unverified', () => {
  // Deliberate direction: the cap is a budget, not a right. Suppressing a
  // paid-for reminder because a counter could not be read would be the worse
  // failure, so the send is allowed and the fact that the guard was not active is
  // reported. (Contrast `push_not_in_pack` above, which is a right and suppresses.)
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: null }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: null, used: 3 }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: undefined, used: undefined }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: -1, used: 0 }), {
    allowed: true, unverified: true, reason: 'push_cap_unverified',
  });
});

test('a confirmed count over the cap is the only thing that suppresses a metered push', () => {
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 0 }), { allowed: true, unverified: false });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 49 }), { allowed: true, unverified: false });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 50 }), {
    allowed: false, unverified: false, reason: 'push_cap_reached',
  });
  assert.deepEqual(resolvePushCapDecision({ cap: 50, used: 51 }), {
    allowed: false, unverified: false, reason: 'push_cap_reached',
  });
});

test('the binding confirmation reply is free and never metered', () => {
  // A-21 + LINE pricing: reply is free. The confirmation is the `booking_created`
  // event on the customer path and `binding_confirmation` on the reply path.
  assert.equal(countsAgainstPushCap('booking_created'), false);
  assert.equal(countsAgainstPushCap('binding_confirmation'), false);
  assert.equal(countsAgainstPushCap('reminder_3h'), true);
  assert.equal(countsAgainstPushCap('deposit_rejected'), true);
  assert.deepEqual(METERED_PUSH_EVENTS, ['reminder_3h', 'reminder_24h', 'deposit_rejected', 'deposit_slip_decision']);
  assert.ok(UNMETERED_EVENTS.includes('binding_confirmation'));
});

test('the month window is the Thai calendar month, resetting on the 1st', () => {
  // 2026-10-01T00:00+07:00 is 2026-09-30T17:00Z — still October in Bangkok.
  assert.equal(bangkokMonthKey(new Date('2026-09-30T17:00:00Z')), '2026-10-01');
  assert.equal(bangkokMonthKey(new Date('2026-09-30T16:59:59Z')), '2026-09-01');
  assert.equal(bangkokMonthKey(new Date('2026-10-31T16:59:59Z')), '2026-10-01');
  assert.equal(bangkokMonthKey(new Date('2026-10-31T17:00:00Z')), '2026-11-01');
});

test('no pack number is hard-coded in the metering module or the route', () => {
  // Comments may cite the locked numbers as documentation; only code counts here.
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const budget = read('apps/booking-consumer/src/lib/notification-push-budget.ts');
  assert.doesNotMatch(stripComments(budget), /\b(?:50|600|1500)\b/, 'the cap is a plan value, never a literal (A-21: retunable)');
  // The mirror table holds it in exactly one place, and it is a plan table, not code.
  const route = read('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');
  assert.doesNotMatch(stripComments(route), /\b(?:600|1500)\b/);
});
