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
  assert.equal(FREE_PLAN_SERVICES, 3);
  assert.equal(BASIC_PLAN_PRICE_THB, 390);
  assert.equal(BASIC_PLAN_PRICE_USD, 11);

  const th = JSON.parse(read('apps/booking-admin/messages/th.json'));
  const en = JSON.parse(read('apps/booking-admin/messages/en.json'));
  for (const messages of [th, en]) {
    const planCopy = JSON.stringify({ auth: messages.auth, dashboard: messages.dashboard });
    assert.match(planCopy, /390/);
    assert.match(planCopy, /50/);
    // No invented numbers: the retired walls and the unanswered Pro price stay out.
    assert.doesNotMatch(planCopy, /490|990|฿790|\$23|100 bookings|500 bookings|100 คิว|500 คิว/);
  }
  assert.match(JSON.stringify(th.auth), /1 ร้าน/);
  assert.match(JSON.stringify(th.auth), /3 บริการ/);
  assert.match(JSON.stringify(en.auth), /1 shop/);
  assert.match(JSON.stringify(en.auth), /3 services/);
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
