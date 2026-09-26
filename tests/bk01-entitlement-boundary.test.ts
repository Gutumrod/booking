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
  require_("CHECK (plan_code <> 'pro' OR NOT is_publicly_sellable)");
  require_('ADD CONSTRAINT entitlement_plans_pro_not_sellable');
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
  require_('UPDATE local_service.services AS s SET is_active = false');
  require_('UPDATE local_service.services SET is_active = true');
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
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
  // PUBLIC is never named as a grantee (the policy allowlist rejects it outright).
  assert.doesNotMatch(sql, /\b(TO|FROM)\s+PUBLIC\b/i);
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
