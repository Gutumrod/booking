import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  BASIC_PLAN_PRICE_THB,
  BASIC_PLAN_PRICE_USD,
  FREE_PLAN_BOOKINGS_PER_MONTH,
  FREE_PLAN_SERVICES,
  FREE_PLAN_SHOPS,
  PLAN_PRICE_STATUS,
  evaluatePlanLimit,
  getPlanPresentation,
  resolveMonthlyPlan,
} from '../apps/booking-admin/src/lib/commercial-contract.ts';

const read = (path: string) => readFileSync(path, 'utf8');

const APP_SRC_DIRS = [
  'apps/booking-admin/src',
  'apps/booking-consumer/src',
];

const MESSAGE_CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
  'apps/booking-consumer/messages/th.json',
  'apps/booking-consumer/messages/en.json',
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments may cite a retired price as a warning; only code counts here. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * The DB still stores the legacy identifiers `free_trial` / `basic_490` /
 * `pro_990` (renaming them needs a migration this work unit does not apply), so
 * the identifier text is removed before looking for a retired *price*.
 */
const withoutLegacyPlanIds = (source: string) => source.replace(/basic_490|pro_990/g, '');

// ---------------------------------------------------------------------------
// Owner-approved plan facts (Addendum A item 1, "A-2", recorded 2026-09-26)
// ---------------------------------------------------------------------------

test('Free plan holds the approved 50 bookings / 1 shop / 3 services limits', () => {
  assert.equal(FREE_PLAN_BOOKINGS_PER_MONTH, 50);
  assert.equal(FREE_PLAN_SHOPS, 1);
  assert.equal(FREE_PLAN_SERVICES, 3);
  assert.deepEqual(getPlanPresentation('free_trial'), {
    planId: 'free_trial',
    priceThb: 0,
    priceUsd: 0,
    priceStatus: PLAN_PRICE_STATUS,
    isPurchasable: false,
    bookingsPerMonth: 50,
    shops: 1,
    services: 3,
  });
});

test('Basic carries the approved ฿390 / $11 and the retired ฿490 is gone', () => {
  assert.equal(BASIC_PLAN_PRICE_THB, 390);
  assert.equal(BASIC_PLAN_PRICE_USD, 11);
  assert.equal(PLAN_PRICE_STATUS, 'owner-approved-2026-09-26');
  const basic = getPlanPresentation('basic_490');
  assert.equal(basic.priceThb, 390);
  assert.equal(basic.priceUsd, 11);
  assert.equal(basic.isPurchasable, true);
});

test('Pro exists but has no approved price and is not purchasable', () => {
  const pro = getPlanPresentation('pro_990');
  assert.equal(pro.isPurchasable, false);
  assert.equal(pro.priceThb, null);
  assert.equal(pro.priceUsd, null);
});

test('checkout resolves only Basic — never Pro, never annual, never free', () => {
  const basic = resolveMonthlyPlan('basic_490');
  assert.equal(basic?.planId, 'basic_490');
  assert.equal(basic?.priceEnvName, 'STRIPE_PRICE_BASIC');
  assert.equal(resolveMonthlyPlan('pro_990'), null);
  assert.equal(resolveMonthlyPlan('free_trial'), null);
  assert.equal(resolveMonthlyPlan('basic_annual'), null);
  assert.equal(resolveMonthlyPlan('pro_annual'), null);
  assert.equal(resolveMonthlyPlan(undefined), null);
});

// ---------------------------------------------------------------------------
// Boundary 1 — bookings per month (a Free shop at 50 is done; a Basic shop is not)
// ---------------------------------------------------------------------------

test('booking-limit boundary: a Free shop books while under 50 and is blocked at 50 or above', () => {
  const lastAllowed = evaluatePlanLimit('free_trial', 'bookings_per_month', 49);
  assert.equal(lastAllowed.limit, 50);
  assert.equal(lastAllowed.usage, 49);
  assert.equal(lastAllowed.allowed, true);
  assert.equal(lastAllowed.code, null);

  const onLimit = evaluatePlanLimit('free_trial', 'bookings_per_month', 50);
  assert.equal(onLimit.limit, 50);
  assert.equal(onLimit.usage, 50);
  assert.equal(onLimit.allowed, false);
  assert.equal(onLimit.code, 'BOOKING_QUOTA_EXCEEDED');

  const overLimit = evaluatePlanLimit('free_trial', 'bookings_per_month', 51);
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.code, 'BOOKING_QUOTA_EXCEEDED');

  const emptyShop = evaluatePlanLimit('free_trial', 'bookings_per_month', 0);
  assert.equal(emptyShop.allowed, true);

  // The approved Free limit, not a legacy 100/500 wall.
  assert.equal(evaluatePlanLimit('free_trial', 'bookings_per_month', 99).allowed, false);
});

test('booking-limit boundary: Basic has no customer-facing booking wall', () => {
  for (const usage of [0, 50, 51, 5000]) {
    const decision = evaluatePlanLimit('basic_490', 'bookings_per_month', usage);
    assert.equal(decision.allowed, true);
    assert.equal(decision.limit, null);
    assert.equal(decision.code, null);
  }
});

// ---------------------------------------------------------------------------
// Boundary 2 — services (the 4th service is the wall)
// ---------------------------------------------------------------------------

test('service-limit boundary: a Free shop adds a 3rd service but not a 4th', () => {
  const secondService = evaluatePlanLimit('free_trial', 'services', 1);
  assert.equal(secondService.limit, 3);
  assert.equal(secondService.allowed, true);

  const thirdService = evaluatePlanLimit('free_trial', 'services', 2);
  assert.equal(thirdService.allowed, true);
  assert.equal(thirdService.code, null);

  const fourthService = evaluatePlanLimit('free_trial', 'services', 3);
  assert.equal(fourthService.limit, 3);
  assert.equal(fourthService.usage, 3);
  assert.equal(fourthService.allowed, false);
  assert.equal(fourthService.code, 'SERVICE_LIMIT_EXCEEDED');

  const fifthService = evaluatePlanLimit('free_trial', 'services', 4);
  assert.equal(fifthService.allowed, false);
  assert.equal(fifthService.code, 'SERVICE_LIMIT_EXCEEDED');
});

test('service-limit boundary: Basic has no service wall', () => {
  for (const usage of [0, 3, 4, 50]) {
    assert.equal(evaluatePlanLimit('basic_490', 'services', usage).allowed, true);
  }
});

test('shop-limit boundary: the Free plan allows 1 shop and blocks a 2nd', () => {
  assert.equal(evaluatePlanLimit('free_trial', 'shops', 0).allowed, true);
  const secondShop = evaluatePlanLimit('free_trial', 'shops', 1);
  assert.equal(secondShop.allowed, false);
  assert.equal(secondShop.code, 'SHOP_LIMIT_EXCEEDED');
  assert.equal(evaluatePlanLimit('basic_490', 'shops', 5).allowed, true);
});

// ---------------------------------------------------------------------------
// No admin surface may purchase or preselect Pro, or show a retired price
// ---------------------------------------------------------------------------

test('no admin surface can purchase, upgrade to or preselect Pro', () => {
  for (const file of APP_SRC_DIRS.flatMap(collectSourceFiles)) {
    const code = stripComments(read(file));
    assert.doesNotMatch(code, /startBillingCheckout\s*\([^)]*pro_990/, `${file} starts a Pro checkout`);
    assert.doesNotMatch(code, /handleUpgrade\s*\(\s*['"]pro_990['"]\s*\)/, `${file} upgrades to Pro`);
    assert.doesNotMatch(code, /setSelectedPlan\s*\(\s*['"]pro_990['"]\s*\)/, `${file} can preselect Pro`);
  }
});

test('the checkout client is typed to Basic only', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  assert.match(service, /startBillingCheckout\(plan: 'basic_490'\)/);
  assert.doesNotMatch(stripComments(service), /startBillingCheckout\(plan:[^)]*pro_990/);
});

test('no admin code or catalogue still shows the retired 490/990 plan prices', () => {
  for (const path of MESSAGE_CATALOGUES) {
    const raw = read(path);
    assert.doesNotMatch(
      withoutLegacyPlanIds(raw),
      /490|990/,
      `${path} still references a retired BK01 plan price`,
    );
  }
  for (const file of APP_SRC_DIRS.flatMap(collectSourceFiles)) {
    const code = withoutLegacyPlanIds(stripComments(read(file)));
    assert.doesNotMatch(code, /490|990/, `${file} still contains a retired BK01 plan price`);
  }
});

test('the admin catalogue states the approved ฿390 and the Free limits', () => {
  for (const path of ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json']) {
    const messages = JSON.parse(read(path));
    assert.match(JSON.stringify(messages.dashboard), /390/);
    assert.match(JSON.stringify(messages.auth), /390/);
    for (const section of ['auth', 'dashboard'] as const) {
      assert.match(JSON.stringify(messages[section]), /50/, `${path}.${section} must state the 50 limit`);
    }
  }
});
