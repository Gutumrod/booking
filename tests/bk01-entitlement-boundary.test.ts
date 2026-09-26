// BK01 entitlement boundary tests — free/basic/trial rules from Owner Addendum
// A-2 / A-3 and Addendum C (R2).
//
// NO DATABASE IS CONTACTED. This machine has no Docker, no psql and no pg_dump,
// and the work unit forbids applying the migration, so every assertion here is
// one of two static kinds:
//
//   1. SQL TEXT: the exact statement/literal that the migration file contains
//      (comment-stripped, whitespace-normalised), proven by reading the file.
//   2. DECISION LOGIC: the branch conditions of the migration's functions,
//      re-expressed in TypeScript and exercised across the boundary cases
//      (50/51 bookings, month roll-over, 3rd/4th service, 1st/2nd shop, trial
//      expiring into free entitlements).
//
// What this proves: the SQL that will run on the database decides the boundary
// cases the way the Owner locked them. What it does NOT prove: that PostgreSQL
// accepts the DDL/DML, that a real transaction behaves this way, or any applied
// state. Those need a live database and are out of this work unit's authority.
//
// The migration file is read at its real path; the note file is read only to
// prove it landed complete (no placeholder text) as the work unit requires.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { validateBk01MigrationSql } from '../scripts/lib/bk01-migration-policy.mjs';

const MIGRATION_DIR = 'supabase/bk01-migrations';
const MIGRATION_FILE = '20260926120000_bk01_entitlement_packs.sql';
const MIGRATION_PATH = `${MIGRATION_DIR}/${MIGRATION_FILE}`;
const NOTE_PATH = 'docs/house-swarm-1/WUC-DB-MIGRATION.md';

const rawSql = readFileSync(MIGRATION_PATH, 'utf8');
// The file as the server would parse it: comments removed, whitespace folded.
const sql = rawSql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const note = readFileSync(NOTE_PATH, 'utf8');

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
const has = (needle: string) => sql.includes(squash(needle));
const require_ = (needle: string) => assert.ok(has(needle), `migration is missing: ${squash(needle)}`);

// Whitespace-insensitive variant. Several migration statements are deliberately
// wrapped across lines for readability, so an assertion must never depend on
// where the line breaks land — this folds every run of whitespace, including
// newlines inside an expression, before comparing.
const sqlNoSpace = sql.replace(/\s+/g, '');
const hasTight = (needle: string) => sqlNoSpace.includes(needle.replace(/\s+/g, ''));
const requireTight_ = (needle: string) =>
  assert.ok(hasTight(needle), `migration is missing (whitespace-insensitive): ${needle}`);

// ---------------------------------------------------------------------------
// Minimal SQL readers (single-quote and parenthesis aware) so seeded numbers
// are asserted as data, not as substrings.
// ---------------------------------------------------------------------------

function readParenGroup(text: string, openIndex: number): { body: string; end: number } {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
    }
  }
  throw new Error('unbalanced parenthesis in migration text');
}

function splitTopLevel(body: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") {
          current += "'";
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

type SeededRows = Record<string, string>[];

function seededRows(table: string): SeededRows {
  const marker = `INSERT INTO ${table} (`;
  const upper = rawSql.toUpperCase();
  const start = upper.indexOf(marker.toUpperCase());
  assert.ok(start >= 0, `no INSERT INTO ${table} found in ${MIGRATION_PATH}`);

  const columnGroup = readParenGroup(rawSql, start + marker.length - 1);
  const columns = splitTopLevel(columnGroup.body).map((value) => value.trim().toLowerCase());

  const valuesIndex = upper.indexOf('VALUES', columnGroup.end);
  assert.ok(valuesIndex >= 0, `no VALUES clause for ${table}`);

  const rows: SeededRows = [];
  let cursor = rawSql.indexOf('(', valuesIndex);
  while (cursor >= 0) {
    const group = readParenGroup(rawSql, cursor);
    const values = splitTopLevel(group.body);
    assert.equal(values.length, columns.length, `${table} row arity mismatch: ${group.body}`);
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = values[index];
    });
    rows.push(row);
    const next = rawSql.slice(group.end + 1).search(/^\s*,/);
    if (next !== 0) break;
    cursor = rawSql.indexOf('(', group.end);
  }
  return rows;
}

const unquote = (value: string) => value.trim().replace(/^'|'$/g, '').replace(/''/g, "'");
const isNull = (value: string) => value.trim().toUpperCase() === 'NULL';

const planRows = seededRows('local_service.entitlement_plans');
const planRow = (code: string): Record<string, string> => {
  const row = planRows.find((candidate) => unquote(candidate.plan_code) === code);
  assert.ok(row, `plan row ${code} is not seeded`);
  return row as Record<string, string>;
};

const trialRows = seededRows('local_service.trial_promotions');
const businessTypeRows = seededRows('local_service.business_types');

// ---------------------------------------------------------------------------
// Decision logic re-expressed from the migration's own branches.
// ---------------------------------------------------------------------------

// local_service.bk01_month_key: date_trunc('month', p_at AT TIME ZONE 'Asia/Bangkok')::date
const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const BANGKOK_MONTH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
});

function bangkokMonthKey(iso: string): string {
  const parts = BANGKOK_MONTH.formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-01`;
}

function bangkokDate(iso: string): string {
  const parts = BANGKOK_DATE.formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

// local_service.bk01_bookings_used_in_month
const COUNTED_STATUSES = ['pending_review', 'confirmed', 'completed', 'no_show'];

type BookingRow = {
  shopId: string;
  status: string;
  startTimestamptz: string;
  expiresAt: string | null;
};

function bookingsUsedInMonth(rows: BookingRow[], shopId: string, monthKey: string, nowIso: string): number {
  return rows.filter(
    (row) =>
      row.shopId === shopId &&
      (COUNTED_STATUSES.includes(row.status) ||
        (row.status === 'hold' && (row.expiresAt === null || row.expiresAt > nowIso))) &&
      bangkokMonthKey(row.startTimestamptz) === monthKey,
  ).length;
}

// local_service.enforce_booking_quota (the branches, in order)
type GateResult = { outcome: 'accepted' | 'refused'; topupBalance: number };

function bookingQuotaGate(used: number, bookingsLimit: number | null, topupBalance: number): GateResult {
  if (bookingsLimit === null) return { outcome: 'accepted', topupBalance };
  if (used < bookingsLimit) return { outcome: 'accepted', topupBalance };
  if (topupBalance > 0) return { outcome: 'accepted', topupBalance: topupBalance - 1 };
  return { outcome: 'refused', topupBalance };
}

// local_service.bk01_shop_effective_plan
function effectivePlan(
  plan: string | null,
  status: string | null,
  currentPeriodEnd: string | null,
  trialEndsAt: string | null,
  nowIso: string,
): string {
  if (plan === null || status === null) return 'free';
  if (plan === 'pro_990' && status === 'active') return 'pro_990';
  if (plan === 'basic_490' && (status === 'active' || status === 'past_due')) return 'basic_490';
  if (plan === 'basic_490' && status === 'trialing') {
    const end = currentPeriodEnd ?? trialEndsAt;
    if (end !== null && end > nowIso) return 'basic_490';
    return 'free';
  }
  return 'free';
}

// local_service.enforce_shop_booking_acceptance
const NON_ACCEPTING_STATUSES = ['canceled', 'incomplete', 'incomplete_expired', 'unpaid'];

function bookingAcceptance(input: {
  shopIsActive: boolean;
  subscriptionStatus: string | null;
  trialPeriodEnd: string | null;
  effective: string;
  usedThisMonth: number;
  freeCeiling: number | null;
  nowIso: string;
}): 'ACCEPTED' | 'REFUSED_SHOP_NOT_ACCEPTING' {
  if (
    !input.shopIsActive ||
    input.subscriptionStatus === null ||
    NON_ACCEPTING_STATUSES.includes(input.subscriptionStatus)
  ) {
    return 'REFUSED_SHOP_NOT_ACCEPTING';
  }
  if (
    input.subscriptionStatus === 'trialing' &&
    input.trialPeriodEnd !== null &&
    input.trialPeriodEnd <= input.nowIso &&
    input.effective === 'free'
  ) {
    if (input.freeCeiling !== null && input.usedThisMonth >= input.freeCeiling) {
      return 'REFUSED_SHOP_NOT_ACCEPTING';
    }
  }
  return 'ACCEPTED';
}

// local_service.create_service / set_service_active (v_total counts every service of the shop)
function serviceCreateGate(totalServices: number, servicesLimit: number | null): string {
  return servicesLimit !== null && totalServices >= servicesLimit ? 'SERVICE_LIMIT_EXCEEDED' : 'created';
}

// local_service.provision_owner_shop (one shop per account on free)
function shopCreateGate(ownedShops: number, freeShopsLimit: number | null): string {
  return ownedShops >= (freeShopsLimit ?? 1) ? '23505' : 'provisioned';
}

const freeBookingsLimit = () => (isNull(planRow('free').bookings_per_month) ? null : Number(planRow('free').bookings_per_month));
const basicBookingsLimit = () =>
  isNull(planRow('basic_490').bookings_per_month) ? null : Number(planRow('basic_490').bookings_per_month);
const freeServicesLimit = () => Number(planRow('free').services_limit);
const freeShopsLimit = () => Number(planRow('free').shops_limit);

// ---------------------------------------------------------------------------
// 1. The migration itself
// ---------------------------------------------------------------------------

test('exactly one forward migration exists and the repository policy accepts it', () => {
  const files = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files, [MIGRATION_FILE]);
  assert.match(MIGRATION_FILE, /^\d{14}_[a-z0-9_]+\.sql$/);
  assert.equal(validateBk01MigrationSql(rawSql, MIGRATION_FILE), true);
});

test('the migration declares its target database and its predecessor', () => {
  assert.match(rawSql, /--\s*Target:\s+BK01 product database/);
  assert.match(rawSql, /--\s*Predecessor:/);
  require_("plan_code IN ('free', 'basic_490', 'pro_990')");
});

// ---------------------------------------------------------------------------
// 2. Owner-locked plan data
// ---------------------------------------------------------------------------

test('free plan row is 50 bookings per calendar month, 1 shop, 3 services, no deposit', () => {
  const free = planRow('free');
  assert.equal(free.bookings_per_month, '50');
  assert.equal(free.shops_limit, '1');
  assert.equal(free.services_limit, '3');
  assert.equal(free.promptpay_deposit_allowed, 'false');
  assert.equal(free.price_thb, '0');
  assert.equal(free.price_usd, '0');
  assert.equal(free.is_publicly_sellable, 'true');

  // The month is a Thailand-time calendar month, not a rolling 30 days.
  require_('bookings_per_month INTEGER');
  require_('CHECK (bookings_per_month IS NULL OR bookings_per_month > 0)');
  require_("AT TIME ZONE 'Asia/Bangkok'");
  require_("date_trunc( 'month', COALESCE(p_at, now()) AT TIME ZONE 'Asia/Bangkok' )::DATE");
  require_("SELECT p.bookings_per_month FROM local_service.entitlement_plans AS p WHERE p.plan_code = 'free'");
});

test('basic plan row is 390 THB / 11 USD with no booking ceiling at all', () => {
  const basic = planRow('basic_490');
  assert.equal(basic.price_thb, '390');
  assert.equal(basic.price_usd, '11');
  assert.equal(isNull(basic.bookings_per_month), true, 'basic must have no bookings_per_month value');
  assert.equal(basic.is_publicly_sellable, 'true');

  // NULL ceiling is what the two gates read as "no limit" — it is not a large number.
  require_('IF v_limits.bookings_limit IS NULL THEN');
  require_('ELSIF v_used < v_limits.bookings_limit THEN');
});

test('pro is not sold and the database refuses a sellable pro row', () => {
  const pro = planRow('pro_990');
  assert.equal(pro.is_publicly_sellable, 'false');
  // F-9 replaced the dead exact-name constraint. What is asserted here is the
  // surviving invariant: the seeded Pro row is not sellable, and the rule that
  // holds it that way is on the data. The full generic rule is F-9's own test.
  require_('is_pro_family');
  require_('CHECK (NOT is_pro_family OR NOT is_publicly_sellable)');
  require_('ADD CONSTRAINT entitlement_plans_pro_family_not_sellable');
});

test('the trial is a promotion row separate from the free plan', () => {
  const trial = trialRows.find((row) => unquote(row.promotion_code) === 'basic_trial_14d');
  assert.ok(trial, 'basic_trial_14d promotion is not seeded');
  assert.equal(unquote((trial as Record<string, string>).entitlement_plan_code), 'basic_490');
  assert.notEqual(unquote((trial as Record<string, string>).entitlement_plan_code), 'free');
  assert.equal((trial as Record<string, string>).duration_days, '14');
  assert.equal((trial as Record<string, string>).is_active, 'true');
  assert.equal((trial as Record<string, string>).claim_ticket_supported, 'true');

  require_('REFERENCES local_service.entitlement_plans (plan_code)');
  require_('CREATE TRIGGER trg_apply_trial_promotion AFTER INSERT ON local_service.subscriptions');
  require_("SET plan = v_promotion.entitlement_plan_code");
});

test('business types and starter patterns are seeded as table data', () => {
  assert.ok(businessTypeRows.length >= 9, 'expected the seeded business type set');
  for (const row of businessTypeRows) {
    assert.match(unquote(row.type_code), /^[a-z][a-z0-9_]*$/);
    assert.match(row.starter_pattern, /^'\{.*\}'::jsonb$/);
    assert.match(unquote(row.starter_pattern), /"services":\[/);
  }
  require_('starter_pattern JSONB NOT NULL');
  require_('ADD COLUMN business_type_code TEXT');
  require_('COALESCE(v_type.starter_pattern -> \'services\', \'[]\'::JSONB)');
  require_("WHERE type_code = 'other'");
});

// ---------------------------------------------------------------------------
// 3. The 50 / 51 boundary and the monthly reset
// ---------------------------------------------------------------------------

test('the fifty-first booking in a Thailand calendar month is refused, the fiftieth accepted', () => {
  const nowIso = '2026-09-15T03:00:00.000Z';
  const monthKey = bangkokMonthKey(nowIso);
  const shopId = 'shop-1';
  const row = (day: number): BookingRow => ({
    shopId,
    status: 'confirmed',
    startTimestamptz: `2026-09-${String(day).padStart(2, '0')}T03:00:00.000Z`,
    expiresAt: null,
  });

  const fortyNine = Array.from({ length: 49 }, (_unused, index) => row((index % 27) + 1));
  const used = bookingsUsedInMonth(fortyNine, shopId, monthKey, nowIso);
  assert.equal(used, 49);

  // The 50th: 49 used < 50, so the insert passes and the counter becomes 50.
  const fiftieth = bookingQuotaGate(used, freeBookingsLimit(), 0);
  assert.equal(fiftieth.outcome, 'accepted');
  const usedAfterFiftieth = used + 1;
  assert.equal(usedAfterFiftieth, 50);

  // The 51st: 50 used is not < 50 and the free plan carries no top-up balance.
  const fiftyFirst = bookingQuotaGate(usedAfterFiftieth, freeBookingsLimit(), 0);
  assert.equal(fiftyFirst.outcome, 'refused');

  // Refusal is an error code, never a delete.
  require_("MESSAGE = 'BOOKING_QUOTA_EXCEEDED'");
  require_('CREATE TRIGGER trg_enforce_booking_quota BEFORE INSERT ON local_service.bookings');
});

test('the month resets on the first: the same shop books again in the new month', () => {
  const september = '2026-09-30T16:59:59.000Z'; // 2026-09-30 23:59:59 in Bangkok
  const october = '2026-09-30T17:00:00.000Z'; // 2026-10-01 00:00:00 in Bangkok
  assert.equal(bangkokMonthKey(september), '2026-09-01');
  assert.equal(bangkokMonthKey(october), '2026-10-01');
  assert.equal(bangkokDate(september), '2026-09-30');
  assert.equal(bangkokDate(october), '2026-10-01');

  const shopId = 'shop-1';
  const rows: BookingRow[] = Array.from({ length: 50 }, (_unused, index) => ({
    shopId,
    status: 'confirmed',
    startTimestamptz: `2026-09-${String((index % 27) + 1).padStart(2, '0')}T03:00:00.000Z`,
    expiresAt: null,
  }));

  // The October window is empty even though the shop is full in September.
  const usedOctober = bookingsUsedInMonth(rows, shopId, bangkokMonthKey(october), october);
  assert.equal(usedOctober, 0, 'September bookings must not count in the October window');
  assert.equal(bookingQuotaGate(usedOctober, freeBookingsLimit(), 0).outcome, 'accepted');

  // The September window still sees all 50, so the reset is the month key, not a wipe.
  const usedSeptember = bookingsUsedInMonth(rows, shopId, bangkokMonthKey(september), september);
  assert.equal(usedSeptember, 50);
  assert.equal(bookingQuotaGate(usedSeptember, freeBookingsLimit(), 0).outcome, 'refused');

  // The reset is a counter write keyed on the Thailand month, driven by the booking rows.
  require_("IF v_plan = 'free' AND v_ledger_month <> v_current_month THEN");
  require_('SET bookings_used = local_service.bk01_bookings_used_in_month(p_shop_id, v_current_month)');
});

test('cancelled, expired and stale holds release the slot; live holds consume it', () => {
  const nowIso = '2026-09-15T03:00:00.000Z';
  const monthKey = bangkokMonthKey(nowIso);
  const start = '2026-09-10T03:00:00.000Z';
  const rows: BookingRow[] = [
    { shopId: 's', status: 'cancelled', startTimestamptz: start, expiresAt: null },
    { shopId: 's', status: 'expired', startTimestamptz: start, expiresAt: '2026-09-09T03:00:00.000Z' },
    { shopId: 's', status: 'hold', startTimestamptz: start, expiresAt: '2026-09-09T03:00:00.000Z' },
    { shopId: 's', status: 'hold', startTimestamptz: start, expiresAt: '2026-09-15T03:15:00.000Z' },
    { shopId: 's', status: 'pending_review', startTimestamptz: start, expiresAt: null },
    { shopId: 's', status: 'no_show', startTimestamptz: start, expiresAt: null },
  ];
  assert.equal(bookingsUsedInMonth(rows, 's', monthKey, nowIso), 3);

  require_("b.status IN ('pending_review', 'confirmed', 'completed', 'no_show')");
  require_("b.status = 'hold' AND (b.expires_at IS NULL OR b.expires_at > now())");
});

test('basic has no ceiling: the same 51st booking is accepted', () => {
  assert.equal(basicBookingsLimit(), null);
  assert.equal(bookingQuotaGate(50, basicBookingsLimit(), 0).outcome, 'accepted');
  assert.equal(bookingQuotaGate(5000, basicBookingsLimit(), 0).outcome, 'accepted');
});

// ---------------------------------------------------------------------------
// 4. The third versus fourth service, and the first versus second shop
// ---------------------------------------------------------------------------

test('the third service is created on free and the fourth is refused', () => {
  const limit = freeServicesLimit();
  assert.equal(limit, 3);
  assert.equal(serviceCreateGate(0, limit), 'created');
  assert.equal(serviceCreateGate(1, limit), 'created');
  assert.equal(serviceCreateGate(2, limit), 'created'); // the 3rd
  assert.equal(serviceCreateGate(3, limit), 'SERVICE_LIMIT_EXCEEDED'); // the 4th

  // Both write paths are gated, and the count is over every service of the shop.
  require_('IF v_limit IS NOT NULL AND v_total >= v_limit THEN');
  require_('MESSAGE = \'SERVICE_LIMIT_EXCEEDED\'');
  require_('FROM local_service.services WHERE shop_id = v_shop_id');
});

test('the excess service is switched off, never deleted', () => {
  // Corrected statement: the disable carries the row alias `AS s` (the F-7
  // correlated probe below needs `s.id`/`s.is_active`), and it writes the
  // system-disabled marker in the SAME statement. The rejected commit left the
  // marker out entirely and switched on every off row, which is what let it
  // revive a service the owner had switched off.
  require_('UPDATE local_service.services AS s SET is_active = false, entitlement_disabled = true');
  require_('UPDATE local_service.services SET is_active = true, entitlement_disabled = false');
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  // Switching a service off is never a delete: the row survives, and the two
  // columns can never contradict each other.
  require_('ADD CONSTRAINT services_not_active_and_entitlement_disabled');
  require_('CHECK (NOT (is_active AND entitlement_disabled))');
});

test('the first shop is provisioned and the second is refused', () => {
  const limit = freeShopsLimit();
  assert.equal(limit, 1);
  assert.equal(shopCreateGate(0, limit), 'provisioned');
  assert.equal(shopCreateGate(1, limit), '23505');

  require_('IF v_owned_shops >= COALESCE(v_shops_limit, 1) THEN');
  require_("RAISE EXCEPTION 'This account already owns a shop' USING ERRCODE = '23505'");
});

// ---------------------------------------------------------------------------
// 5. A trial expiring into free entitlements, without closing the shop
// ---------------------------------------------------------------------------

test('a running trial is Basic and an expired trial is free, never a closed shop', () => {
  const nowIso = '2026-09-15T03:00:00.000Z';
  const running = effectivePlan('basic_490', 'trialing', '2026-09-20T03:00:00.000Z', null, nowIso);
  assert.equal(running, 'basic_490');

  const expired = effectivePlan('basic_490', 'trialing', '2026-09-14T03:00:00.000Z', null, nowIso);
  assert.equal(expired, 'free');

  const expiredNoPeriod = effectivePlan('basic_490', 'trialing', null, '2026-09-14T03:00:00.000Z', nowIso);
  assert.equal(expiredNoPeriod, 'free');

  const paid = effectivePlan('basic_490', 'active', '2026-10-14T03:00:00.000Z', null, nowIso);
  assert.equal(paid, 'basic_490');

  assert.equal(effectivePlan(null, null, null, null, nowIso), 'free');

  require_("IF v_plan = 'basic_490' AND v_status = 'trialing' THEN");
  require_("IF COALESCE(v_period_end, v_trial_ends_at) IS NOT NULL AND COALESCE(v_period_end, v_trial_ends_at) > now() THEN");
  require_("RETURN 'free';");
});

test('a booking on the day after the trial ends is accepted under free entitlements', () => {
  const nowIso = '2026-09-15T03:00:00.000Z';
  const trialEnd = '2026-09-14T03:00:00.000Z';
  const effective = effectivePlan('basic_490', 'trialing', trialEnd, trialEnd, nowIso);
  assert.equal(effective, 'free');

  const twelveUsed = 12; // day 1 of the month after the trial lapsed
  assert.equal(
    bookingAcceptance({
      shopIsActive: true,
      subscriptionStatus: 'trialing',
      trialPeriodEnd: trialEnd,
      effective,
      usedThisMonth: twelveUsed,
      freeCeiling: freeBookingsLimit(),
      nowIso,
    }),
    'ACCEPTED',
  );

  // 'trialing' is not in the fail-closed refusal list — only genuinely dead states are.
  require_("v_subscription_status IN ('canceled', 'incomplete', 'incomplete_expired', 'unpaid')");
  require_("MESSAGE = 'SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS'");
});

test('the shop is not closed and the subscription row is not rewritten to free', () => {
  // Nothing sets a shop inactive, and nothing writes status = 'free'.
  assert.doesNotMatch(sql, /SET\s+is_active\s*=\s*false[\s\S]{0,120}?local_service\.shops/i);
  assert.doesNotMatch(sql, /UPDATE\s+local_service\.shops\s+SET\s+is_active\s*=\s*false/i);
  assert.doesNotMatch(sql, /status\s*=\s*'free'/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);

  // The fallback is resolved at read time, and convergence only ever disables.
  require_('local_service.bk01_shop_effective_plan(p_shop_id)');
  require_('local_service.bk01_reapply_shop_entitlements(p_shop_id)');
  require_('UPDATE local_service.staff AS st SET is_active = false');
  require_('local_service.bk01_restore_services_within_limit(p_shop_id)');
});

test('free cannot take a PromptPay deposit, and the booking still goes through', () => {
  assert.equal(planRow('free').promptpay_deposit_allowed, 'false');
  assert.equal(planRow('basic_490').promptpay_deposit_allowed, 'true');
  require_("v_deposit_required := COALESCE(v_shop.require_deposit, true) AND v_limits.promptpay_deposit_allowed");
  require_("v_status := 'confirmed';");
});

// ---------------------------------------------------------------------------
// 6. The migration is a forward-only, non-destructive file
// ---------------------------------------------------------------------------

test('the migration contains no DO block, no transaction control and no deletes', () => {
  assert.doesNotMatch(sql, /\bDO\s+\$[a-z0-9_]*\$/i);
  assert.doesNotMatch(sql, /(^|;)\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bCREATE\s+ROLE\b/i);
  assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
  // F-6: PUBLIC may only ever appear as a REVOKE grantee. A GRANT to PUBLIC is
  // still forbidden — PostgreSQL gives every new function EXECUTE to PUBLIC, so
  // the REVOKE is what closes the hole, and the GRANT is what opens it.
  assert.doesNotMatch(sql, /\bGRANT\b[^;]*\bTO\s+PUBLIC\b/i);
  assert.match(sql, /\bREVOKE\s+ALL\s+ON\s+FUNCTION\b[^;]*\bFROM\s+PUBLIC\b/i);
});

// ---------------------------------------------------------------------------
// F-6 — every function this migration creates must revoke PUBLIC's default
// EXECUTE, including the SECURITY INVOKER trigger function and including a
// CREATE OR REPLACE that changes the signature.
// ---------------------------------------------------------------------------

type FunctionCreation = { signature: string; security: 'DEFINER' | 'INVOKER'; replaced: boolean };

// Normalise a signature so the two sides compare as PostgreSQL resolves them:
// only the schema-qualified name and the argument TYPE list matter, never the
// spacing or the parameter names. VARCHAR and TEXT are distinct types, so the
// file must name the same type on both sides of the pair.
const signatureArgumentTypes = (rawArguments: string) =>
  squash(rawArguments)
    .split(',')
    .map((part) => part.trim().replace(/\s+default\s+[\s\S]*$/i, ''))
    .filter((part) => part.length > 0)
    // A declaration names its parameter (`p_at timestamptz`); a REVOKE target
    // does not (`timestamptz`).
    .map((part) => {
      const tokens = part.split(' ').filter((token) => token.length > 0);
      return (tokens.length > 1 ? tokens.slice(1) : tokens).join(' ').toUpperCase();
    });

const normalizeSignature = (qualifiedName: string, rawArguments: string) =>
  `${squash(qualifiedName).toUpperCase()}(${signatureArgumentTypes(rawArguments).join(', ')})`;

// Enumerated from the file itself: the function name plus its argument type
// list, which is the identity PostgreSQL resolves privileges against.
function parseFunctionCreations(): FunctionCreation[] {
  const pattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_.]*)\s*\(([\s\S]*?)\)\s*RETURNS\b([\s\S]*?)\bAS\s+\$/gi;
  const creations: FunctionCreation[] = [];
  for (const match of Array.from(rawSql.matchAll(pattern))) {
    creations.push({
      signature: normalizeSignature(match[1], match[2]),
      security: /\bSECURITY\s+INVOKER\b/i.test(match[3]) ? 'INVOKER' : 'DEFINER',
      replaced: /CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(match[0]),
    });
  }
  return creations;
}

const functionCreations = parseFunctionCreations();
const revokeFromPublicSignatures = new Set<string>();
{
  const revokeRe = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+([a-z_][a-z0-9_.]*)\s*\(([^)]*)\)\s+FROM\s+([^;]+);/gi;
  for (const match of Array.from(rawSql.matchAll(revokeRe))) {
    if (!/\bPUBLIC\b/i.test(match[3])) continue;
    revokeFromPublicSignatures.add(normalizeSignature(match[1], match[2]));
  }
}

// local_service.bk01_restore_services_within_limit (the F-7 shape, re-expressed).
// A service is re-enabled only when the SYSTEM disabled it for entitlement
// reasons in a month that is not the current one. A service the owner switched
// off (entitlement_disabled = false) is never touched.
type ServiceState = {
  id: string;
  createdAt: number;
  isActive: boolean;
  entitlementDisabled: boolean;
  lastEntitledMonth: string | null;
};

function restoreTargets(services: ServiceState[], servicesLimit: number | null, monthKey: string): string[] {
  if (servicesLimit === null) return [];
  return services
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, servicesLimit)
    .filter(
      (service) =>
        service.entitlementDisabled === true &&
        service.isActive === false &&
        service.lastEntitledMonth !== monthKey,
    )
    .map((service) => service.id);
}

// local_service.bk01_reapply_shop_entitlements (the F-7 shape): the enable set
// is the restore target list, the disable set is every active service with no
// stamp for the current month.
function reapply(input: { services: ServiceState[]; servicesLimit: number | null; monthKey: string }): {
  enabled: string[];
  disabled: string[];
} {
  const enabled = restoreTargets(input.services, input.servicesLimit, input.monthKey);
  const disabled = input.services
    .filter((service) => service.isActive === true && service.lastEntitledMonth !== input.monthKey)
    .map((service) => service.id);
  return { enabled, disabled };
}

// F-9: the whole Pro family, decided from the identifier prefix — never from an
// exact name.
const isProFamily = (planCode: string) => planCode.toLowerCase().startsWith('pro');
function planSeeded(planCode: string, isPubliclySellable: boolean): 'seeded' | 'CHECK violation' {
  return isProFamily(planCode) && isPubliclySellable ? 'CHECK violation' : 'seeded';
}

// F-10: the limit counts only ENABLED services (the row being switched on is
// not yet enabled, so it is not counted twice).
function reenableGate(rows: { isActive: boolean }[], servicesLimit: number | null): string {
  const enabled = rows.filter((row) => row.isActive === true).length;
  return servicesLimit !== null && enabled >= servicesLimit ? 'SERVICE_LIMIT_EXCEEDED' : 'reactivated';
}

test('F-6 every function created by the migration revokes PUBLIC, including the SECURITY INVOKER one', () => {
  assert.ok(functionCreations.length >= 20, `expected the file's function set, found ${functionCreations.length}`);
  assert.equal(
    functionCreations.filter((creation) => creation.security === 'INVOKER').length >= 1,
    true,
    'expected the SECURITY INVOKER trigger function to be in scope',
  );

  for (const creation of functionCreations) {
    assert.ok(
      revokeFromPublicSignatures.has(creation.signature),
      `no REVOKE ALL ON FUNCTION ... FROM PUBLIC for ${creation.signature} (${creation.security})`,
    );
  }

  // The INVOKER function specifically, and the replaced signature that the
  // review called out as a second function object.
  assert.ok(
    functionCreations.some(
      (creation) => creation.signature === 'LOCAL_SERVICE.ENFORCE_SHOP_BOOKING_ACCEPTANCE()' && creation.security === 'INVOKER',
    ),
  );
  assert.ok(
    revokeFromPublicSignatures.has('LOCAL_SERVICE.GET_TIER_LIMITS(TEXT)'),
    'the like-for-like replacement get_tier_limits(text) must revoke PUBLIC',
  );
  assert.match(rawSql, /REVOKE ALL ON FUNCTION local_service\.enforce_shop_booking_acceptance\(\) FROM PUBLIC, anon, authenticated, service_role;/);
});

test('F-7 a service the owner switched off stays off when the plan is re-converged', () => {
  const monthKey = '2026-09-01';
  const services: ServiceState[] = [
    { id: 'a', createdAt: 1, isActive: false, entitlementDisabled: false, lastEntitledMonth: '2026-09-01' },
    { id: 'b', createdAt: 2, isActive: true, entitlementDisabled: false, lastEntitledMonth: '2026-09-01' },
    { id: 'c', createdAt: 3, isActive: true, entitlementDisabled: false, lastEntitledMonth: '2026-09-01' },
  ];

  const result = reapply({ services, servicesLimit: 3, monthKey });
  assert.deepEqual(result.enabled, [], 'the owner-disabled service must not be revived');
  assert.deepEqual(result.disabled, []);
  // The owner's service is outside the enabled set, so a re-convergence cannot
  // silently switch it back on — which is exactly what the rejected commit did.
  assert.equal(restoreTargets(services, 3, monthKey).includes('a'), false);

  // The SQL carries the same separation: the owner's switch-off writes the flag
  // false, and the revive path refuses every row that is not system-disabled.
  require_('entitlement_disabled = false');
  require_('AND s.entitlement_disabled = true');
});

test('F-7 a service the system switched off comes back when the plan allows it again', () => {
  const monthKey = '2026-09-01';
  const services: ServiceState[] = [
    // System switch-off from an earlier entitlement month: comes back.
    { id: 'system', createdAt: 1, isActive: false, entitlementDisabled: true, lastEntitledMonth: '2026-08-01' },
    // Owner switch-off: never comes back.
    { id: 'owner', createdAt: 2, isActive: false, entitlementDisabled: false, lastEntitledMonth: '2026-08-01' },
  ];

  assert.deepEqual(restoreTargets(services, 3, monthKey), ['system']);
  // Inside the allowance, a Free shop cannot keep a system-disabled service off.
  assert.deepEqual(restoreTargets([{ ...services[0], lastEntitledMonth: null }], 3, monthKey), ['system']);
  // Beyond the allowance (limit 0), nothing comes back.
  assert.deepEqual(restoreTargets(services, 0, monthKey), []);

  // And the SQL: only the system flag is read on the enable path.
  require_('UPDATE local_service.services SET is_active = true, entitlement_disabled = false');
  require_("AND s.entitlement_disabled = true");
});

test('F-7 automatic restore is not invoked from the booking path or the usage read path', () => {
  // The convergence call is gone from create_booking_hold and get_entitlement_usage.
  const holdStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.create_booking_hold(');
  const usageStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.get_entitlement_usage(');
  assert.ok(holdStart > 0 && usageStart > holdStart, 'expected both functions in the file');
  const holdBody = rawSql.slice(holdStart, usageStart);
  assert.doesNotMatch(holdBody, /bk01_reapply_shop_entitlements/);
  assert.doesNotMatch(holdBody, /bk01_restore_services_within_limit/);

  const usageBody = rawSql.slice(usageStart, rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.apply_trial_promotion('));
  assert.doesNotMatch(usageBody, /bk01_reapply_shop_entitlements/);
  assert.doesNotMatch(usageBody, /bk01_restore_services_within_limit/);

  // The plan-change path is the only caller left.
  require_('CREATE OR REPLACE FUNCTION local_service.bk01_apply_plan_change(p_shop_id UUID)');
  assert.match(rawSql, /RETURN local_service\.bk01_reapply_shop_entitlements\(p_shop_id\);/);
  assert.match(rawSql, /REVOKE ALL ON FUNCTION local_service\.bk01_apply_plan_change\(UUID\) FROM PUBLIC, anon, authenticated;/);
  // The system switch-off records its own reason.
  require_('SET is_active = false, entitlement_disabled = true');
});

test('F-8 an unknown or Thai-language category can never fail the business type foreign key', () => {
  require_('business_type_code = CASE');
  // The classification expression is wrapped across lines in the file, so it is
  // asserted whitespace-insensitively: only the SQL itself matters, never where
  // the line breaks land.
  //
  // Corrected shape: the slug expression is WRAPPED in an EXISTS probe against
  // the seeded type list, so the value written is always either a code the
  // foreign key accepts or the seeded 'other' code. The rejected commit wrote
  // the bare slug first and repaired the misses in a SECOND statement, but the
  // foreign key is checked as soon as the first statement runs, so any shop
  // whose category was free text or Thai text aborted the whole migration.
  // The wrapper is the EXISTS(...) guard itself, NOT an outer COALESCE.
  requireTight_("WHEN EXISTS (SELECT 1 FROM local_service.business_types AS bt WHERE bt.type_code = btrim(lower(regexp_replace(coalesce(business_category, ''), '[^a-zA-Z0-9]+', '_', 'g'))))");
  requireTight_("THEN btrim(lower(regexp_replace(coalesce(business_category, ''), '[^a-zA-Z0-9]+', '_', 'g')))");
  require_("ELSE 'other'");
  require_('WHERE business_type_code IS NULL');
  require_('FROM local_service.business_types AS bt');
  // The guard is what makes the foreign key unfailable, so the bare slug must
  // never be the thing that reaches the column.
  assert.doesNotMatch(
    sql,
    /SET business_type_code = COALESCE/i,
    'the slug must not be wrapped in a COALESCE that can still write a non-seeded code',
  );
  // One statement writes the column, and the old two-step backfill is gone.
  assert.equal(
    (sql.match(/SET business_type_code/g) ?? []).length,
    1,
    'the backfill must be a single statement, not the rejected two-step pass',
  );
  assert.doesNotMatch(
    rawSql,
    /SET business_type_code = btrim\(lower\(regexp_replace\(/,
    'the unconditional first pass that could violate the foreign key must be gone',
  );

  // The decision, re-expressed: a value is written only when it names a seeded
  // type, so the foreign key cannot fail on any input, including Thai text.
  const seeded = new Set(businessTypeRows.map((row) => unquote(row.type_code)));
  // Faithful to the SQL: regexp_replace folds every non-alphanumeric run to a
  // single '_', and btrim() over the RESULT trims spaces only (there are none
  // left), so no underscore is stripped either. Stripping leading/trailing
  // underscores here would make this reader more permissive than the statement.
  const slugOf = (category: string) => category.toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_');
  const backfill = (category: string) => (seeded.has(slugOf(category)) ? slugOf(category) : 'other');

  assert.equal(backfill('barber'), 'barber'); // matches a seeded code
  assert.equal(backfill('car_care'), 'car_care'); // an underscore code survives the fold
  assert.equal(backfill('ร้านตัดผม'), 'other'); // Thai text slugifies to '_' — never a type code
  assert.equal(backfill('unknown-shop-type'), 'other');
  assert.equal(backfill(''), 'other');
  assert.equal(backfill('   '), 'other');
  for (const category of ['ร้านตัดผม', 'คาร์แคร์ล้างรถ', 'unknown-shop-type', '', '  ', '💈 บาร์เบอร์', 'beauty']) {
    assert.ok(seeded.has(backfill(category)), `backfill(${JSON.stringify(category)}) violates the foreign key`);
  }
});

test('F-9 every Pro-family identifier is unsellable by a generic prefix rule, not an exact name', () => {
  // The dead exact-name constraint is gone.
  assert.doesNotMatch(rawSql, /plan_code <> 'pro'/);
  require_("is_pro_family BOOLEAN GENERATED ALWAYS AS (plan_code LIKE 'pro%') STORED");
  require_('CHECK (NOT is_pro_family OR NOT is_publicly_sellable)');
  require_('ADD CONSTRAINT entitlement_plans_pro_family_not_sellable');

  // The real identifiers that exist in the data.
  assert.equal(planSeeded('pro_990', false), 'seeded'); // the seeded Pro row, unsellable
  assert.equal(planSeeded('pro_990', true), 'CHECK violation');
  assert.equal(planSeeded('pro', false), 'seeded'); // the exact name the review tested
  assert.equal(planSeeded('pro', true), 'CHECK violation'); // the old constraint missed this
  assert.equal(planSeeded('pro_1490', true), 'CHECK violation'); // a future Pro family member
  assert.equal(planSeeded('pro_trial', true), 'CHECK violation');
  // Sellable non-Pro plans are untouched.
  assert.equal(planSeeded('free', true), 'seeded');
  assert.equal(planSeeded('basic_490', true), 'seeded');

  const pro = planRow('pro_990');
  assert.equal(pro.is_publicly_sellable, 'false');
});

test('F-10 a Free shop that switched a service off can switch it back on', () => {
  const limit = freeServicesLimit();
  assert.equal(limit, 3);

  // Free shop with 3 services, one switched off by the owner: 2 enabled.
  const rows = [
    { isActive: true },
    { isActive: true },
    { isActive: false, entitlementDisabled: false },
  ];
  assert.equal(reenableGate(rows, limit), 'reactivated');
  // Counting every row (the rejected behaviour) would have refused this.
  assert.equal(rows.length >= limit, true);

  // A fourth ENABLED service is still refused on Free.
  assert.equal(reenableGate([{ isActive: true }, { isActive: true }, { isActive: true }], limit), 'SERVICE_LIMIT_EXCEEDED');
  // Basic is uncapped for services at 50.
  assert.equal(reenableGate(Array.from({ length: 49 }, () => ({ isActive: true })), 50), 'reactivated');

  // The SQL: both gates count only enabled services, and each count is the full
  // statement that decides the allowance — the rejected version counted every
  // row of the shop, so a Free shop that switched one of its three services off
  // could never switch it back on.
  const enabledCount =
    'SELECT count(*) INTO v_total FROM local_service.services WHERE shop_id = v_shop_id AND is_active = true;';
  assert.equal(
    (sql.match(new RegExp(enabledCount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
    2,
    'both create_service and set_service_active must count only enabled services',
  );
  // The old ungated count must be gone from both gates.
  assert.doesNotMatch(
    sql,
    /SELECT count\(\*\) INTO v_total FROM local_service\.services WHERE shop_id = v_shop_id;/,
    'the rejected count-all-rows gate must be gone',
  );
  require_('SELECT count(*) INTO v_total FROM local_service.services WHERE shop_id = v_shop_id AND is_active = true;');
});

test('N-4 the database is the single source of business type codes and exposes the list to the app role', () => {
  require_('CREATE OR REPLACE VIEW local_service.app_business_types AS');
  require_('SELECT type_code, emoji, label_th, label_en, display_order');
  require_('FROM local_service.business_types');
  require_('WHERE is_active = true');
  require_('ORDER BY display_order ASC, type_code ASC');
  require_('REVOKE ALL ON TABLE local_service.app_business_types FROM PUBLIC, anon, authenticated;');
  require_('GRANT SELECT ON TABLE local_service.app_business_types TO authenticated;');
  // anon must not be able to read the type list.
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE local_service\.app_business_types TO [^;]*\banon\b/i);

  // The column set the UI lane consumes, as data read from the view definition.
  const viewMatch = rawSql.match(/CREATE OR REPLACE VIEW local_service\.app_business_types AS([\s\S]*?);/);
  assert.ok(viewMatch, 'the read-surface view must be in the file');
  const viewSql = squash(viewMatch[1]);
  for (const column of ['type_code', 'emoji', 'label_th', 'label_en', 'display_order']) {
    assert.ok(viewSql.includes(`${column}`), `the view is missing ${column}`);
  }

  // The seeded rows are the source of truth: 9 codes, and the view exposes them.
  assert.equal(businessTypeRows.length, 9);
  const codes = businessTypeRows.map((row) => unquote(row.type_code));
  assert.deepEqual(codes, [
    'barber',
    'car_care',
    'nail_lash',
    'beauty_clinic',
    'spa_massage',
    'studio',
    'sport_court',
    'pet_grooming',
    'other',
  ]);

  // The note documents the surface name and its columns for the consuming lane.
  assert.match(note, /local_service\.app_business_types/);
  assert.match(note, /display_order/);
});

// ---------------------------------------------------------------------------
// 7. The work-unit note landed complete
// ---------------------------------------------------------------------------

test('the note exists, has no placeholder text, and records the no-write boundary', () => {
  assert.ok(note.trim().length > 1000, 'note looks empty');
  assert.doesNotMatch(note, /IN PROGRESS/);
  assert.doesNotMatch(note, /filled in below/i);
  assert.match(note, /nothing was applied/i);
  assert.match(note, /no database connection was attempted/i);
  assert.match(note, /no commit/i);
  assert.match(note, /no push/i);
  assert.match(note, /sha256/i);
  for (const rule of ['50', '390', '11', 'free', 'basic', 'trial']) {
    assert.ok(note.includes(rule), `note does not mention ${rule}`);
  }
});
