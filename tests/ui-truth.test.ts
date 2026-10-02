import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { BASIC_PLAN_PRICE_THB, BASIC_PLAN_PRICE_USD, FREE_PLAN_BOOKINGS_PER_MONTH, FREE_PLAN_SERVICES, FREE_PLAN_SHOPS } from '../apps/booking-admin/src/lib/commercial-contract.ts';

/**
 * UI-side guard for review round 2 finding F-1 (work unit H1-WUC-UI-TRUTH).
 *
 * The plan limits are evaluated in TypeScript only. The database does not enforce
 * them and the migration that would is written but NOT applied. These tests stop
 * the admin surface from drifting back into claiming enforcement it does not have.
 */

const read = (path: string) => readFileSync(path, 'utf8');

const ADMIN_CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
];

const ADMIN_PLAN_FILES = [
  'apps/booking-admin/src/lib/commercial-contract.ts',
  'apps/booking-admin/src/app/register/page.tsx',
  'apps/booking-admin/src/app/dashboard/page.tsx',
  'apps/booking-admin/src/app/platform-admin/page.tsx',
];

/** Wording that asserts an enforcement layer the system does not have. */
const FALSE_ENFORCEMENT_CLAIMS: ReadonlyArray<[RegExp, string]> = [
  [/mirror the codes raised/i, 'claims the error codes are raised by SQL'],
  [/authoritative gate\s+(?:stays|is)\s+server-side/i, 'claims an authoritative server-side gate'],
  [/fair-use protected server-side/i, 'claims server-side fair-use protection'],
  [/limits are enforced server-side/i, 'claims the limits are enforced server-side'],
  [/these codes are raised by the server/i, 'claims the server raises the limit codes'],
];

/** A string may only state a limit if it also says the limit is not live yet. */
const PENDING_MARKER = {
  th: /ยังไม่|ยังนับ|รอ migration|รอ Owner/,
  en: /not enforced|does not enforce|nothing enforces|not active yet|migration pending|pending migration|placeholder|awaiting Owner/i,
} as const;

const PLAN_COPY_KEYS = {
  landing: ['featureFreeTrial'],
  auth: [
    'pilotReferenceNotice',
    'planFreeDesc',
    'planFreeQ1',
    'planFreeQ2',
    'planFreeQ3',
    'planFreeExcluded',
    'planBasicDesc',
    'planBasicQ1',
    'planBasicQ2',
    'planProNote',
  ],
  dashboard: [
    'planBasicDesc',
    'usageLimitTitle',
    'usageLimitBookings',
    'usageLimitServices',
    'usageLimitUpgrade',
    'planLabelFree',
  ],
} as const;

test('no admin plan surface claims server-side or SQL enforcement of the limits', () => {
  for (const path of ADMIN_PLAN_FILES) {
    const source = read(path);
    for (const [pattern, description] of FALSE_ENFORCEMENT_CLAIMS) {
      assert.doesNotMatch(source, pattern, `${path} ${description}`);
    }
  }
  for (const path of ADMIN_CATALOGUES) {
    const raw = read(path);
    for (const [pattern, description] of FALSE_ENFORCEMENT_CLAIMS) {
      assert.doesNotMatch(raw, pattern, `${path} ${description}`);
    }
  }
});

test('the plan contract states that database enforcement is written but not applied', () => {
  const contract = read('apps/booking-admin/src/lib/commercial-contract.ts');
  assert.match(contract, /has NOT been applied/);
  // SHOP/SERVICE limit codes must be described as absent from the migrations.
  assert.match(contract, /SHOP_LIMIT_EXCEEDED/);
  assert.match(contract, /SERVICE_LIMIT_EXCEEDED/);
  assert.match(contract, /do NOT exist in any/);
  // The live gaps must be named, not smoothed over.
  assert.match(contract, /100 bookings/);
  assert.match(contract, /LIFETIME/);
  assert.match(contract, /NO shop limit and NO service limit/i);
  assert.match(contract, /14-day/);
});

test('the register page marks its limit check as a non-enforcing intent check', () => {
  const register = read('apps/booking-admin/src/app/register/page.tsx');
  assert.match(register, /NOT enforcement/);
  assert.match(register, /NOT\s*\n?\s*applied|written but NOT/);
});

test('every admin plan or limit string states that enforcement is pending', () => {
  for (const path of ADMIN_CATALOGUES) {
    const locale = path.endsWith('th.json') ? 'th' : 'en';
    const messages = JSON.parse(read(path));
    for (const [section, keys] of Object.entries(PLAN_COPY_KEYS)) {
      for (const key of keys) {
        const value = messages[section][key];
        assert.equal(typeof value, 'string', `${path}.${section}.${key} must exist`);
        assert.match(value, PENDING_MARKER[locale], `${path}.${section}.${key} states a limit without saying enforcement is pending`);
      }
    }
  }
});

test('the admin catalogue still carries the locked commercial facts unchanged', () => {
  assert.equal(FREE_PLAN_BOOKINGS_PER_MONTH, 50);
  assert.equal(FREE_PLAN_SHOPS, 1);
  // A-21 (2026-10-01) raised the Free service allowance from 3 to 5. The mirror of
  // the database value (`SIGNUP_PLAN_SERVICES_LIMIT.free_trial`) deliberately stays
  // 3 until the unit-7 migration raises the seeded row — both are pinned below.
  assert.equal(FREE_PLAN_SERVICES, 5);
  assert.equal(BASIC_PLAN_PRICE_THB, 390);
  assert.equal(BASIC_PLAN_PRICE_USD, 11);

  const th = JSON.parse(read('apps/booking-admin/messages/th.json'));
  const en = JSON.parse(read('apps/booking-admin/messages/en.json'));
  for (const messages of [th, en]) {
    const planCopy = JSON.stringify({ auth: messages.auth, dashboard: messages.dashboard });
    assert.match(JSON.stringify(messages.auth), messages === th ? /฿390/ : /\$11/);
    assert.match(planCopy, /50/);
    // No invented numbers: the retired walls and the unanswered Pro price stay out.
    assert.doesNotMatch(planCopy, /490|990|฿790|\$23|100 bookings|500 bookings|100 คิว|500 คิว/);
    // The retired 3-service allowance must not survive anywhere in the plan copy.
    assert.doesNotMatch(planCopy, /3\s*บริการ|3\s*services/);
  }
  assert.match(JSON.stringify(th.auth), /1 ร้าน/);
  assert.match(JSON.stringify(th.auth), /5 บริการ/);
  assert.match(JSON.stringify(en.auth), /1 shop/);
  assert.match(JSON.stringify(en.auth), /5 services/);
});

test('the Free service allowance is 5 in the contract, the app copy and the signup mirror', () => {
  // H6 / G34: A-21 raised Free to 5 services. The P0 SQL set makes the DATABASE
  // agree, and this app set makes every SURFACE a user reads agree, so the three can
  // only move together. The signup mirror is the one place that could promise a
  // starter set the database then refuses to create, so it is pinned hardest.
  assert.equal(FREE_PLAN_SERVICES, 5);
  const mirror = read('apps/booking-admin/src/lib/business-type-starter-services.ts');
  assert.match(mirror, /free_trial:\s*5/, 'the signup mirror must offer the 5 services A-21 sells');
  assert.match(mirror, /A-21/, 'the mirror must record WHY it is 5');
  const register = read('apps/booking-admin/src/app/register/page.tsx');
  assert.doesNotMatch(register, /previews at most 3 services/, 'the signup comment must not still say 3');
});

test('the WUC-UI-TRUTH note records the blocked database work and the untouched database', () => {
  const path = 'docs/house-swarm-1/WUC-UI-TRUTH.md';
  assert.ok(existsSync(path), `${path} must exist`);
  const note = read(path);
  assert.match(note, /not applied|NOT applied|NOT been applied/);
  assert.match(note, /BLOCKED/);
  assert.match(note, /no database connection was attempted/i);
  assert.match(note, /no commit or push/i);
});
