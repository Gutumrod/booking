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

test('forward migrations exist in timestamp order and the repository policy accepts each', () => {
  const files = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files, [MIGRATION_FILE, '20260927120000_bk01_runtime_route_rpcs.sql', '20260927130000_bk01_trial_line_bind.sql', '20260928120000_bk01_house_upload_grants.sql', '20260930120000_bk01_link_token_no_extensions.sql', '20261001023000_bk01_queue_release.sql', '20261001130000_bk01_sql_consolidate.sql', '20261001140000_bk01_pack_notify_group67.sql', '20261002120000_bk01_council_p0.sql', '20261002130000_bk01_p0_alert_context.sql', '20261002140000_bk01_review_f1_f2.sql', '20261002150000_bk01_p1_g09_g10.sql', '20261002160000_bk01_g10_line_binding_audit.sql']);
  assert.match(MIGRATION_FILE, /^\d{14}_[a-z0-9_]+\.sql$/);
  assert.equal(validateBk01MigrationSql(rawSql, MIGRATION_FILE), true);
  assert.equal(validateBk01MigrationSql(readFileSync(`${MIGRATION_DIR}/20260927120000_bk01_runtime_route_rpcs.sql`, 'utf8'), '20260927120000_bk01_runtime_route_rpcs.sql'), true);
  assert.equal(validateBk01MigrationSql(readFileSync(`${MIGRATION_DIR}/20260927130000_bk01_trial_line_bind.sql`, 'utf8'), '20260927130000_bk01_trial_line_bind.sql'), true);
  assert.equal(validateBk01MigrationSql(readFileSync(`${MIGRATION_DIR}/20260928120000_bk01_house_upload_grants.sql`, 'utf8'), '20260928120000_bk01_house_upload_grants.sql'), true);
  const linkTokenMigration = readFileSync(`${MIGRATION_DIR}/20260930120000_bk01_link_token_no_extensions.sql`, 'utf8');
  assert.equal(validateBk01MigrationSql(linkTokenMigration, '20260930120000_bk01_link_token_no_extensions.sql'), true);
  assert.match(linkTokenMigration, /BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE:\s*local_service\.generate_link_token\(\)/);
  assert.match(linkTokenMigration, /ALTER POLICY "Users view own shop memberships"\s+ON local_service\.shop_users/);
  assert.doesNotMatch(linkTokenMigration.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' '), /\bauth\s*\./i);
  const queueReleaseMigration = readFileSync(`${MIGRATION_DIR}/20261001023000_bk01_queue_release.sql`, 'utf8');
  assert.equal(validateBk01MigrationSql(queueReleaseMigration, '20261001023000_bk01_queue_release.sql'), true);
  assert.match(queueReleaseMigration, /queue_released_at IS NULL/);
  assert.match(queueReleaseMigration, /local_service\.bk01_pending_past_appointment_count/);
  assert.match(queueReleaseMigration, /status='pending_review'[\s\S]*?end_timestamptz < now\(\)/);
  assert.match(queueReleaseMigration, /SET queue_released_at = now\(\)[\s\S]*?tstzrange\(v_start_tz, v_end_tz, '\[\)'\)/);
  const sqlConsolidation = readFileSync(`${MIGRATION_DIR}/20261001130000_bk01_sql_consolidate.sql`, 'utf8');
  assert.equal(validateBk01MigrationSql(sqlConsolidation, '20261001130000_bk01_sql_consolidate.sql'), true);
  const packNotify = readFileSync(`${MIGRATION_DIR}/20261001140000_bk01_pack_notify_group67.sql`, 'utf8');
  assert.equal(validateBk01MigrationSql(packNotify, '20261001140000_bk01_pack_notify_group67.sql'), true);
  assert.match(packNotify, /ALTER TABLE local_service\.entitlement_plans[\s\S]*monthly_push_cap/);
  assert.match(packNotify, /reminder_3h/);
  const lineBindingAudit = readFileSync(`${MIGRATION_DIR}/20261002160000_bk01_g10_line_binding_audit.sql`, 'utf8');
  assert.equal(validateBk01MigrationSql(lineBindingAudit, '20261002160000_bk01_g10_line_binding_audit.sql'), true);
  assert.match(lineBindingAudit, /AFTER INSERT OR UPDATE OR DELETE ON local_service\.line_users/);
  assert.match(lineBindingAudit, /AFTER UPDATE OF line_user_id ON local_service\.customers/);
  assert.match(packNotify, /FORCE ROW LEVEL SECURITY/);
  assert.match(packNotify, /SKIP LOCKED/);
  assert.doesNotMatch(packNotify, /ALTER TABLE local_service\.shops/i);
  assert.match(sqlConsolidation, /COALESCE\(customer_cancel_before_hours, 24\)/);
  assert.match(sqlConsolidation, /COALESCE\(customer_reschedule_before_hours, 12\)/);
  assert.match(sqlConsolidation, /p_customer_cancel_before_hours IS NULL OR p_customer_cancel_before_hours < 0/);
  assert.match(sqlConsolidation, /p_customer_reschedule_before_hours IS NULL OR p_customer_reschedule_before_hours < 0/);
  assert.match(sqlConsolidation, /p_outcome='no_show' AND v_booking\.start_timestamptz>now\(\)/);
  assert.match(sqlConsolidation, /v_booking\.end_timestamptz <= now\(\)/);
  assert.match(sqlConsolidation, /local_service\.audit_events/);
  assert.match(sqlConsolidation, /event_type IN \('reminder_1h','reminder_24h'\)/);
  assert.doesNotMatch(sqlConsolidation, /CREATE OR REPLACE FUNCTION local_service\.enforce_booking_status_transition/);
  assert.doesNotMatch(sqlConsolidation, /prevent_overlapping_staff_bookings/);
  assert.doesNotMatch(sqlConsolidation.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' '), /\bauth\s*\./i);
  assert.doesNotMatch(queueReleaseMigration, /bk01_release_overdue_queues|GRANT EXECUTE ON FUNCTION local_service\.bk01_[^;]+ TO service_role/i);
  assert.match(queueReleaseMigration, /queue_released_at IS NOT NULL THEN[\s\S]*?confirmation is unavailable/);
  assert.throws(() => validateBk01MigrationSql('CREATE OR REPLACE FUNCTION local_service.other() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n-- BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE: local_service.generate_link_token()', '20260930120000_bk01_link_token_no_extensions.sql'), /must match exactly one/);
  assert.throws(() => validateBk01MigrationSql('CREATE OR REPLACE FUNCTION local_service.generate_link_token() RETURNS text LANGUAGE sql AS $$ SELECT \'x\' $$;\n-- BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE: local_service.generate_link_token()', 'crafted:not-a11.sql'), /limited to the A11 migration/);
  for (const name of files) {
    const source = readFileSync(`${MIGRATION_DIR}/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
    assert.doesNotMatch(source, /\bextensions\s*\./i, `${name} must not depend on extensions`);
  }
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
  // F-12 CHANGED THIS ASSERTION: the signup page reads the type list before the
  // user has a session, so anon is granted SELECT on this ONE projection. What
  // was forbidden before F-12 is now required, and what F-12 still forbids is
  // any grant on the SOURCE table. The negative assertion that survives is the
  // one that matters: anon must never reach local_service.business_types.
  require_('GRANT SELECT ON TABLE local_service.app_business_types TO anon;');
  assert.doesNotMatch(
    sql,
    /GRANT\s+[^;]*\bON\s+(?:TABLE\s+)?local_service\.business_types\b[^;]*\bTO\b[^;]*\banon\b/i,
    'anon must not be granted anything on the business_types source table',
  );

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
// F-11 / F-12 / F-13 helpers — the entitlement ordering and the read surfaces,
// re-expressed from the migration's own SQL.
// ---------------------------------------------------------------------------

type EntitlementRow = {
  id: string;
  shopId: string;
  isActive: boolean;
  createdAt: number;
  // services.entitlement_disabled. Absent for a staff row: local_service.staff
  // carries no such marker, which is a real limit of the data, not an oversight.
  systemDisabled?: boolean;
};

// local_service.bk01_entitled_service_ids / bk01_entitled_staff_ids, exactly as
// written in the migration:
//   WHERE shop_id = p_shop_id AND is_active = true
//   ORDER BY created_at ASC, id ASC
//   LIMIT COALESCE((SELECT <limit> FROM bk01_shop_limits(p_shop_id)), 0)
// Consequences the packet names explicitly: the count is taken over ACTIVE rows
// only, so a row the OWNER switched off does not consume the allowance; and a
// NULL limit is 0 entitled rows, which is the fail-closed direction.
function entitledIds(rows: EntitlementRow[], shopId: string, limit: number | null): string[] {
  return rows
    .filter((row) => row.shopId === shopId && row.isActive === true)
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, limit ?? 0)
    .map((row) => row.id);
}

// create_booking_hold (F-11), the service branch.
function bookingServiceGate(serviceId: string, entitled: string[]): string {
  return entitled.includes(serviceId) ? 'accepted' : 'SERVICE_OUTSIDE_PLAN';
}

// create_booking_hold, the customer-chosen staff path.
function bookingStaffGate(chosenStaffId: string, entitled: string[]): string {
  return entitled.includes(chosenStaffId) ? 'accepted' : 'STAFF_OUTSIDE_PLAN';
}

// create_booking_hold, the auto-select path. The entitlement condition sits
// INSIDE the candidate query in the migration, so the candidate list IS the
// entitled list: there is no "choose then reject" outcome to model, and the
// returned candidate cannot be outside the entitlement by construction.
function autoSelectStaff(rows: EntitlementRow[], shopId: string, limit: number | null): string | null {
  return entitledIds(rows, shopId, limit)[0] ?? null;
}

type SurfaceRow = {
  shopId: string;
  itemKind: 'service' | 'staff';
  itemId: string;
  itemName: string;
  isActive: boolean;
  planEntitled: boolean;
  state: 'bookable' | 'plan_excluded' | 'switched_off';
  systemDisabled: boolean | null;
};

// local_service.bk01_shop_entitlement_status, both branches.
function surfaceRows(
  services: (EntitlementRow & { name: string })[],
  staff: (EntitlementRow & { name: string })[],
  shopId: string,
  servicesLimit: number | null,
  staffLimit: number | null,
): SurfaceRow[] {
  const entitledServices = entitledIds(services, shopId, servicesLimit);
  const entitledStaff = entitledIds(staff, shopId, staffLimit);

  const state = (isActive: boolean, entitled: boolean): SurfaceRow['state'] =>
    isActive === true ? (entitled ? 'bookable' : 'plan_excluded') : 'switched_off';

  return [
    ...services
      .filter((row) => row.shopId === shopId)
      .map((row) => {
        const entitled = row.isActive === true && entitledServices.includes(row.id);
        return {
          shopId: row.shopId,
          itemKind: 'service' as const,
          itemId: row.id,
          itemName: row.name,
          isActive: row.isActive,
          planEntitled: entitled,
          state: state(row.isActive, entitled),
          systemDisabled: row.systemDisabled ?? false,
        };
      }),
    ...staff
      .filter((row) => row.shopId === shopId)
      .map((row) => {
        const entitled = row.isActive === true && entitledStaff.includes(row.id);
        return {
          shopId: row.shopId,
          itemKind: 'staff' as const,
          itemId: row.id,
          itemName: row.name,
          isActive: row.isActive,
          planEntitled: entitled,
          state: state(row.isActive, entitled),
          // NULL, not false: the staff table holds no reason column, so the
          // surface says the fact is absent instead of guessing a reason.
          systemDisabled: null,
        };
      }),
  ];
}

// local_service.app_business_type_starter_services. The starter_pattern literal
// is `'{"services":[…],…}'::jsonb`, so the JSON text is everything between the
// opening quote and the trailing `'::jsonb`.
function parseStarterPattern(raw: string): { services: Record<string, unknown>[]; [key: string]: unknown } {
  const text = raw.trim();
  const start = text.startsWith("'") ? 1 : 0;
  const end = text.lastIndexOf("'::jsonb");
  assert.ok(end > start, `unexpected starter_pattern literal: ${text.slice(0, 60)}`);
  const jsonText = text.slice(start, end).replace(/''/g, "'");
  return JSON.parse(jsonText) as { services: Record<string, unknown>[]; [key: string]: unknown };
}

// ===========================================================================
// Reading a view's REAL declared column list.
//
// The reader this replaced matched /\bAS ([a-z_]+)/ over the view body and
// dropped every match whose preceding text ended with ')'. It therefore only
// survived a single-line SELECT list of bare column references:
//
//   * `(svc.is_active = true AND ... ) AS plan_entitled` — the expression ends
//     with ')' so the alias was DISCARDED, and the read surface reported 8 of
//     its 9 columns;
//   * `COALESCE((svc.value ->> 'duration_minutes')::INTEGER, 30) AS
//     duration_minutes` in a SELECT list written across several lines was
//     misread the SAME way, and the starter projection reported 2 of its 4.
//
// It also could not tell a column alias from a relation alias (`FROM x AS svc`,
// `) AS e`, `) AS svc(...)`) or from a name inside a nested subquery, and it
// ignored a select item that carries no AS at all.
//
// The reader below works on the real structure instead of on a regex over the
// text: it finds the view's own top-level SELECT lists by keyword balance
// (SELECT … FROM / UNION ALL …), splits each list on top-level commas, and reads
// each item's exposed name — the alias where the item carries `AS <name>` (or
// the SQL-standard trailing `<name>`), otherwise the final name of the bare
// column reference. An expression with no alias exposes no name and is reported
// as such (which fails the run), so a column can never be silently dropped.
// ===========================================================================

const SELECT_LIST_BOUNDARIES = new Set([
  'FROM',
  'INTO',
  'WHERE',
  'GROUP',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'RETURNING',
]);

// The text between `CREATE OR REPLACE VIEW <name> AS` and the statement's end.
function viewBody(name: string): string {
  const pattern = new RegExp(`CREATE OR REPLACE VIEW local_service\\.${name} AS([\\s\\S]*?);\\n\\n`);
  const match = rawSql.match(pattern);
  assert.ok(match, `the view local_service.${name} must be in the file`);
  return (match as RegExpMatchArray)[1] as string;
}

// Every SELECT list the view body declares: one for the view, one per UNION ALL
// branch. Only depth-0 keywords are considered, so a subquery inside a select
// item, a CASE expression or a function call never starts a list of its own.
function selectLists(body: string): string[] {
  const keywords: { keyword: string; start: number; end: number }[] = [];
  let depth = 0;
  let inString = false;
  let i = 0;

  while (i < body.length) {
    const ch = body[i] as string;
    if (inString) {
      if (ch === "'") {
        if (body[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      let end = i;
      while (end < body.length && /[A-Za-z0-9_]/.test(body[end] as string)) end += 1;
      keywords.push({ keyword: body.slice(i, end).toUpperCase(), start: i, end });
      i = end;
      continue;
    }
    i += 1;
  }

  const lists: string[] = [];
  let index = 0;
  while (index < keywords.length) {
    const current = keywords[index] as { keyword: string; start: number; end: number };
    const previous = index > 0 ? (keywords[index - 1] as { keyword: string }).keyword : null;
    const startsBranch = current.keyword === 'SELECT' && (index === 0 || previous === 'UNION' || previous === 'ALL');
    if (!startsBranch) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let stop = body.length;
    while (cursor < keywords.length) {
      const candidate = keywords[cursor] as { keyword: string; start: number; end: number };
      if (SELECT_LIST_BOUNDARIES.has(candidate.keyword)) {
        stop = candidate.start;
        break;
      }
      cursor += 1;
    }
    lists.push(body.slice(current.end, stop));
    index = cursor;
  }
  assert.ok(lists.length >= 1, 'the view declares no top-level SELECT list');
  return lists;
}

// Split one SELECT list on its top-level commas: a comma inside a function
// call, a CASE expression or a string literal is not a separator.
function splitSelectList(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i] as string;
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (list[i + 1] === "'") {
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
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

// The name one select item exposes: the alias if it has one (`AS item_kind`,
// `'service'::TEXT AS item_kind`, `… ) AS plan_entitled`), else the column name
// of a bare reference (`bt.type_code`, `st.shop_id`). NULL means "an expression
// with no alias", which is an item that exposes nothing nameable.
function itemExposedName(item: string): string | null {
  const text = squash(item);
  const alias = /\bAS\s+([a-z_][a-z0-9_]*)\s*$/i.exec(text);
  if (alias) return alias[1] as string;
  const bare = /^(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)(?:\s+([a-z_][a-z0-9_]*))?$/i.exec(text);
  if (!bare) return null;
  return (bare[2] ?? bare[1]) as string;
}

// Every column name the view declares, across all of its UNION branches. For a
// UNION the branch must declare the same arity, so reading every branch cannot
// invent a name — and a forbidden column introduced in any branch is caught.
function viewColumns(name: string): string[] {
  const items = selectLists(viewBody(name)).flatMap((list) => splitSelectList(list));
  return items.map((item) => {
    const exposed = itemExposedName(item);
    assert.ok(exposed, `a select item of local_service.${name} exposes no column name: ${squash(item)}`);
    return exposed;
  });
}

// Every relation a view reads: `FROM local_service.services AS svc` and
// `JOIN ps01.x`. A `FROM local_service.<fn>(…)` is a set-returning FUNCTION
// call, which is a source of rows but not a table, so it is excluded — which is
// the point here: the question the caller asks is which tables the surface can
// read. A bare `FROM` with no schema-qualified name is reported as such rather
// than dropped, so the caller cannot silently miss an object.
function relationNames(body: string): string[] {
  const names: string[] = [];
  const pattern = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  for (const match of Array.from(body.replace(/\s+/g, ' ').matchAll(pattern))) {
    const after = body.replace(/\s+/g, ' ').slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 1);
    if (after === '(') continue; // a function call, not a relation
    names.push(match[1] as string);
  }
  return names;
}

type StarterServiceRow = {
  typeCode: string;
  serviceOrder: number;
  serviceName: string;
  durationMinutes: number;
};

function starterServicesFor(typeCode: string): StarterServiceRow[] {
  const row = businessTypeRows.find((candidate) => unquote(candidate.type_code) === typeCode);
  assert.ok(row, `business type ${typeCode} is not seeded`);
  const pattern = parseStarterPattern((row as Record<string, string>).starter_pattern);
  const services = Array.isArray(pattern.services) ? pattern.services : [];
  return services.map((service, index) => ({
    typeCode,
    serviceOrder: index,
    serviceName: String(service?.name),
    // The same COALESCE(…, 30) provision_owner_shop applies to a missing
    // duration_minutes.
    durationMinutes:
      service?.duration_minutes === undefined || service?.duration_minutes === null
        ? 30
        : Number(service.duration_minutes),
  }));
}

// provision_owner_shop's starter loop: walk the JSON array in order, stop as
// soon as v_starter_applied >= COALESCE(services_limit, 0).
function provisionedStarterNames(typeCode: string, servicesLimit: number | null): string[] {
  const applied: string[] = [];
  let count = 0;
  for (const service of starterServicesFor(typeCode)) {
    if (count >= (servicesLimit ?? 0)) break;
    applied.push(service.serviceName);
    count += 1;
  }
  return applied;
}

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

// ---------------------------------------------------------------------------
// 8. F-11 — the booking guard: a service or a staff member outside the shop's
//    EFFECTIVE plan entitlement is refused, on a shop whose trial expired with
//    no plan-change call, and nothing is converged or deleted on the way there.
// ---------------------------------------------------------------------------

// The shop in these cases, stated as the packet states it: a subscription row
// still saying 'basic_490' / 'trialing' whose 14-day trial lapsed and which was
// never converged by a plan-change call. bk01_shop_effective_plan resolves it at
// READ time to 'free', so the effective limits are the free plan row's:
// services_limit 3, staff_limit 1. No new plan logic is added anywhere for this;
// the assertion below is that the existing resolver produces it.
function expiredTrialShop(nowIso: string) {
  const trialEnd = '2026-09-01T03:00:00.000Z';
  const effective = effectivePlan('basic_490', 'trialing', trialEnd, trialEnd, nowIso);
  assert.equal(effective, 'free', 'an expired trial with no plan change must resolve to free');
  return {
    effective,
    servicesLimit: effective === 'free' ? freeServicesLimit() : Number(planRow('basic_490').services_limit),
    staffLimit: effective === 'free' ? Number(planRow('free').staff_limit) : Number(planRow('basic_490').staff_limit),
  };
}

test('F-11 an expired trial with no plan-change call cannot book the 4th service', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  assert.equal(shop.effective, 'free');
  assert.equal(shop.servicesLimit, 3);
  assert.equal(shop.staffLimit, 1);

  // Four ACTIVE services, oldest first: the 4th is beyond the effective
  // services_limit of 3, so it is outside the entitlement.
  const services: EntitlementRow[] = [
    { id: 'svc-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'svc-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
    { id: 'svc-3', shopId: 'shop-1', isActive: true, createdAt: 3 },
    { id: 'svc-4', shopId: 'shop-1', isActive: true, createdAt: 4 },
  ];
  const entitled = entitledIds(services, 'shop-1', shop.servicesLimit);
  assert.deepEqual(entitled, ['svc-1', 'svc-2', 'svc-3']);

  assert.equal(bookingServiceGate('svc-1', entitled), 'accepted');
  assert.equal(bookingServiceGate('svc-3', entitled), 'accepted');
  assert.equal(bookingServiceGate('svc-4', entitled), 'SERVICE_OUTSIDE_PLAN');

  // The SQL carries the refusal as an error on the booking path, with the
  // message the packet names.
  require_("MESSAGE = 'SERVICE_OUTSIDE_PLAN'");
  require_('FROM local_service.bk01_entitled_service_ids(p_shop_id) AS e');
  require_('WHERE e.service_id = p_service_id');
});

test('F-11 a staff member beyond the effective cap cannot be booked', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  assert.equal(shop.effective, 'free');
  assert.equal(shop.staffLimit, 1, 'the free effective cap is one provider');

  const staff: EntitlementRow[] = [
    { id: 'stf-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'stf-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
  ];
  const entitled = entitledIds(staff, 'shop-1', shop.staffLimit);
  assert.deepEqual(entitled, ['stf-1']);

  assert.equal(bookingStaffGate('stf-1', entitled), 'accepted');
  assert.equal(bookingStaffGate('stf-2', entitled), 'STAFF_OUTSIDE_PLAN');

  // A Basic shop inside its cap would accept the same member, so the refusal is
  // the plan's, not a blanket staff gate.
  const basicEntitled = entitledIds(staff, 'shop-1', Number(planRow('basic_490').staff_limit));
  assert.deepEqual(basicEntitled, ['stf-1', 'stf-2']);
  assert.equal(bookingStaffGate('stf-2', basicEntitled), 'accepted');

  require_("MESSAGE = 'STAFF_OUTSIDE_PLAN'");
  require_('FROM local_service.bk01_entitled_staff_ids(p_shop_id) AS e');
  require_('WHERE e.staff_id = v_chosen_staff_id');
});

test('F-11 services and staff inside the entitlement can still be booked', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  const services: EntitlementRow[] = [
    { id: 'svc-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'svc-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
    { id: 'svc-3', shopId: 'shop-1', isActive: true, createdAt: 3 },
  ];
  const staff: EntitlementRow[] = [
    { id: 'stf-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'stf-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
    { id: 'other-shop', shopId: 'shop-2', isActive: true, createdAt: 0 },
  ];

  const entitledServices = entitledIds(services, 'shop-1', shop.servicesLimit);
  const entitledStaff = entitledIds(staff, 'shop-1', shop.staffLimit);
  assert.deepEqual(entitledServices, ['svc-1', 'svc-2', 'svc-3']);
  assert.deepEqual(entitledStaff, ['stf-1']);

  for (const id of ['svc-1', 'svc-2', 'svc-3']) {
    assert.equal(bookingServiceGate(id, entitledServices), 'accepted');
  }
  assert.equal(bookingStaffGate('stf-1', entitledStaff), 'accepted');

  // Another shop's rows are never part of this shop's entitlement.
  assert.equal(entitledStaff.includes('other-shop'), false);

  // The guard is read-only: no convergence and no write is reachable from the
  // booking path, which is what keeps F-7 closed.
  const holdStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.create_booking_hold(');
  const holdEnd = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.create_staff(');
  assert.ok(holdStart > 0 && holdEnd > holdStart, 'expected create_booking_hold in the file');
  const holdBody = rawSql.slice(holdStart, holdEnd);
  assert.doesNotMatch(holdBody, /bk01_reapply_shop_entitlements/);
  assert.doesNotMatch(holdBody, /bk01_restore_services_within_limit/);
  assert.doesNotMatch(holdBody, /UPDATE local_service\.services/i);
  assert.doesNotMatch(holdBody, /UPDATE local_service\.staff/i);
  assert.doesNotMatch(holdBody, /INSERT INTO local_service\.services/i);
  assert.doesNotMatch(holdBody, /INSERT INTO local_service\.staff/i);
  assert.doesNotMatch(holdBody, /\bDELETE\s+FROM\b/i);
});

test('F-11 auto-select never selects a staff member beyond the entitlement', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  // The owner switched OFF the oldest member, so it does not consume the
  // allowance and the cap of 1 falls on stf-2 — which is the same answer the
  // migration's ACTIVE-only ordering gives.
  const staff: EntitlementRow[] = [
    { id: 'stf-old', shopId: 'shop-1', isActive: false, createdAt: 1 },
    { id: 'stf-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
    { id: 'stf-3', shopId: 'shop-1', isActive: true, createdAt: 3 },
  ];

  const selected = autoSelectStaff(staff, 'shop-1', shop.staffLimit);
  assert.equal(selected, 'stf-2');
  // The point of putting the condition inside the candidate query: the selected
  // candidate is inside the entitlement by construction, so there is no
  // "selected and then refused" case.
  assert.ok(
    entitledIds(staff, 'shop-1', shop.staffLimit).includes(selected as string),
    'the auto-selected candidate must be inside the entitlement',
  );
  // The member beyond the cap is never chosen, even when it is the only one free.
  assert.notEqual(selected, 'stf-3');

  // The SQL: the entitlement condition is one of the candidate query's own
  // conditions, i.e. inside the WHERE ... LIMIT 1 that selects the staff member —
  // not a refusal applied afterwards.
  const holdStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.create_booking_hold(');
  const holdEnd = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.create_staff(');
  const holdBody = rawSql.slice(holdStart, holdEnd);
  const candidateStart = holdBody.indexOf('IF v_chosen_staff_id IS NULL THEN');
  const candidateEnd = holdBody.indexOf('IF v_chosen_staff_id IS NULL THEN', candidateStart + 1);
  assert.ok(candidateStart > 0 && candidateEnd > candidateStart, 'expected the auto-select branch');
  const candidateQuery = squash(holdBody.slice(candidateStart, candidateEnd));
  assert.match(
    candidateQuery,
    /SELECT 1 FROM local_service\.bk01_entitled_staff_ids\(p_shop_id\) AS e WHERE e\.staff_id = st\.id/,
    'the candidate query must filter on the entitlement set itself',
  );
  assert.match(candidateQuery, /LIMIT 1/);
  assert.ok(
    candidateQuery.indexOf('bk01_entitled_staff_ids') < candidateQuery.indexOf('LIMIT 1'),
    'the entitlement condition must precede the LIMIT inside the candidate query',
  );
  // ... and the STAFF_OUTSIDE_PLAN refusal is NOT in that branch.
  assert.doesNotMatch(candidateQuery, /STAFF_OUTSIDE_PLAN/);
});

test('F-11 a service the owner switched off stays off, stays unbookable, and does not consume the allowance', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  // Free, services_limit 3. Four rows, but the oldest was switched off by the
  // OWNER (entitlement_disabled false), so three rows are active and all three
  // are entitled; svc-4 is active but beyond the allowance.
  const services: (EntitlementRow & { name: string })[] = [
    { id: 'svc-off', shopId: 'shop-1', isActive: false, createdAt: 1, systemDisabled: false, name: 'owner off' },
    { id: 'svc-2', shopId: 'shop-1', isActive: true, createdAt: 2, name: 'two' },
    { id: 'svc-3', shopId: 'shop-1', isActive: true, createdAt: 3, name: 'three' },
    { id: 'svc-4', shopId: 'shop-1', isActive: true, createdAt: 4, name: 'four' },
  ];

  const entitled = entitledIds(services, 'shop-1', shop.servicesLimit);
  // The owner's off service does not consume the allowance...
  assert.equal(entitled.includes('svc-off'), false, 'an off service is never entitled');
  assert.deepEqual(entitled, ['svc-2', 'svc-3', 'svc-4']);
  // ...and it stays unbookable, for the reason it is off, not for an
  // entitlement reason.
  assert.equal(bookingServiceGate('svc-off', entitled), 'SERVICE_OUTSIDE_PLAN');
  const rows = surfaceRows(services, [], 'shop-1', shop.servicesLimit, shop.staffLimit);
  const off = rows.find((row) => row.itemId === 'svc-off');
  assert.equal(off?.state, 'switched_off');
  assert.equal(off?.systemDisabled, false, 'the owner switched it off');

  // Nothing on any of these paths writes or deletes: the row is still there.
  require_("UPDATE local_service.services AS s SET is_active = false, entitlement_disabled = true");
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.equal(services.filter((row) => row.id === 'svc-off').length, 1);
});

test('F-11 no rows are deleted by the entitlement refusal or by either read surface', () => {
  // Migration-level: no delete, truncate or drop of any row or table anywhere in
  // the file, and the two new readers are SELECT-only.
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|VIEW|FUNCTION)\b/i);

  const readerStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.bk01_entitled_service_ids(');
  const readerEnd = rawSql.indexOf('CREATE OR REPLACE VIEW local_service.bk01_shop_entitlement_status AS');
  assert.ok(readerStart > 0 && readerEnd > readerStart, 'expected both readers in the file');
  const readerBody = rawSql.slice(readerStart, readerEnd);
  assert.doesNotMatch(readerBody, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(readerBody, /\bUPDATE\b/i);
  assert.doesNotMatch(readerBody, /\bDELETE\s+FROM\b/i);

  // Behavioural: the over-entitlement rows keep their identity and their state
  // through the refusal — the refusal is an error, never a delete.
  const services: EntitlementRow[] = [
    { id: 'svc-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'svc-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
    { id: 'svc-3', shopId: 'shop-1', isActive: true, createdAt: 3 },
    { id: 'svc-4', shopId: 'shop-1', isActive: true, createdAt: 4 },
  ];
  const staff: EntitlementRow[] = [
    { id: 'stf-1', shopId: 'shop-1', isActive: true, createdAt: 1 },
    { id: 'stf-2', shopId: 'shop-1', isActive: true, createdAt: 2 },
  ];
  const before = JSON.stringify({ services, staff });
  assert.equal(bookingServiceGate('svc-4', entitledIds(services, 'shop-1', 3)), 'SERVICE_OUTSIDE_PLAN');
  assert.equal(bookingStaffGate('stf-2', entitledIds(staff, 'shop-1', 1)), 'STAFF_OUTSIDE_PLAN');
  assert.equal(JSON.stringify({ services, staff }), before, 'the refusal must not mutate or drop a row');
  assert.equal(services.length, 4);
  assert.equal(staff.length, 2);
});

// ---------------------------------------------------------------------------
// 9. F-11 — the read surface the listing and the dashboard call
// ---------------------------------------------------------------------------

test('F-11 the read surface distinguishes a plan exclusion from an owner switch-off', () => {
  const shop = expiredTrialShop('2026-09-15T03:00:00.000Z');
  const services: (EntitlementRow & { name: string })[] = [
    // The oldest three are inside the Free allowance of 3.
    { id: 'svc-1', shopId: 'shop-1', isActive: true, createdAt: 1, name: 'one' },
    { id: 'svc-2', shopId: 'shop-1', isActive: true, createdAt: 2, name: 'two' },
    { id: 'svc-3', shopId: 'shop-1', isActive: true, createdAt: 3, name: 'three' },
    // Outside the allowance (the 4th of 3): the plan excluded it, but the row
    // itself is still active — that is the distinction the surface must make.
    { id: 'svc-4', shopId: 'shop-1', isActive: true, createdAt: 4, name: 'four' },
    // The OWNER switched it off: state switched_off with system_disabled false.
    { id: 'svc-off', shopId: 'shop-1', isActive: false, createdAt: 5, systemDisabled: false, name: 'owner off' },
    // The SYSTEM switched it off for an entitlement reason: also switched_off,
    // but system_disabled true.
    { id: 'svc-sys', shopId: 'shop-1', isActive: false, createdAt: 6, systemDisabled: true, name: 'system off' },
  ];
  const staff: (EntitlementRow & { name: string })[] = [
    { id: 'stf-1', shopId: 'shop-1', isActive: true, createdAt: 1, name: 'one' },
    { id: 'stf-2', shopId: 'shop-1', isActive: true, createdAt: 2, name: 'two' },
  ];

  const rows = surfaceRows(services, staff, 'shop-1', shop.servicesLimit, shop.staffLimit);
  const byId = new Map(rows.map((row) => [row.itemId, row]));

  assert.equal(byId.get('svc-1')?.state, 'bookable');
  assert.equal(byId.get('svc-1')?.planEntitled, true);
  assert.equal(byId.get('svc-4')?.state, 'plan_excluded');
  assert.equal(byId.get('svc-4')?.planEntitled, false);
  assert.equal(byId.get('svc-4')?.isActive, true, 'a plan exclusion leaves the row itself active');

  // The distinction the packet requires: both off rows report switched_off, and
  // only system_disabled tells the two reasons apart.
  assert.equal(byId.get('svc-off')?.state, 'switched_off');
  assert.equal(byId.get('svc-off')?.systemDisabled, false);
  assert.equal(byId.get('svc-sys')?.state, 'switched_off');
  assert.equal(byId.get('svc-sys')?.systemDisabled, true);
  assert.notEqual(byId.get('svc-off')?.systemDisabled, byId.get('svc-sys')?.systemDisabled);

  // A plan exclusion and an owner switch-off are different states, not one
  // "not bookable" state.
  assert.notEqual(byId.get('svc-4')?.state, byId.get('svc-off')?.state);

  // Staff: inside the cap is bookable, beyond the cap is plan_excluded, and the
  // reason column is NULL because the staff table holds no such fact.
  assert.equal(byId.get('stf-1')?.state, 'bookable');
  assert.equal(byId.get('stf-2')?.state, 'plan_excluded');
  assert.equal(byId.get('stf-2')?.itemKind, 'staff');
  assert.equal(byId.get('stf-2')?.systemDisabled, null);

  // Both kinds are in one surface, and both roles' names are already public.
  assert.deepEqual(Array.from(new Set(rows.map((row) => row.itemKind))).sort(), ['service', 'staff']);
  assert.deepEqual(
    Array.from(new Set(rows.map((row) => Object.keys(row).length))),
    [8],
    'every row of the surface has the same eight data fields',
  );
});

test('F-11 the read surface is narrow: SELECT only, no plan internals, no money, no customer data', () => {
  require_('CREATE OR REPLACE VIEW local_service.bk01_shop_entitlement_status AS');
  require_('REVOKE ALL ON TABLE local_service.bk01_shop_entitlement_status FROM PUBLIC, anon, authenticated;');
  require_('GRANT SELECT ON TABLE local_service.bk01_shop_entitlement_status TO anon, authenticated;');

  // Exactly one SELECT grant and no INSERT/UPDATE/DELETE privilege anywhere on
  // the surface — no role and no global ACL is touched to widen it.
  const grantLines = rawSql
    .split('\n')
    .filter((line) => /bk01_shop_entitlement_status/.test(line) && /^\s*GRANT\b/i.test(line));
  assert.deepEqual(grantLines.map((line) => line.trim()), [
    'GRANT SELECT ON TABLE local_service.bk01_shop_entitlement_status TO anon, authenticated;',
  ]);
  assert.doesNotMatch(
    sql,
    /\b(?:GRANT|REVOKE)\b[^;]*\b(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b[^;]*\bbk01_shop_entitlement_status\b/i,
  );
  assert.doesNotMatch(sql, /bk01_shop_entitlement_status[\s\S]{0,80}\b(?:INSERT|UPDATE|DELETE)\b/i);

  // The exact nine-column allowlist, read as the view's REAL declared column
  // list: the two UNION ALL branches, each select list spread across lines, with
  // `state` and `plan_entitled` written as expressions (a CASE and a parenthesised
  // boolean) whose alias IS the column name.
  const viewMatch = rawSql.match(
    /CREATE OR REPLACE VIEW local_service\.bk01_shop_entitlement_status AS([\s\S]*?);\n\n/,
  );
  assert.ok(viewMatch, 'the read surface must be in the file');
  const viewSql = squash(viewMatch[1]);
  for (const column of [
    'AS shop_id',
    "'service'::TEXT AS item_kind",
    "'staff'::TEXT AS item_kind",
    'AS item_id',
    'AS item_name',
    'AS is_active',
    'AS plan_entitled',
    'AS state',
    'AS system_disabled',
    'AS created_at',
  ]) {
    assert.ok(viewSql.includes(column), `the read surface is missing ${column}`);
  }
  // Both branches declare the same nine names, in the same order: the column
  // list PostgreSQL resolves for the view is exactly this.
  const branchColumns = selectLists(viewBody('bk01_shop_entitlement_status')).map((list) =>
    splitSelectList(list).map((item) => itemExposedName(item)),
  );
  assert.equal(branchColumns.length, 2, 'the surface has one branch per item kind');
  assert.deepEqual(branchColumns[0], branchColumns[1], 'both branches must declare the same columns');
  assert.deepEqual(Array.from(new Set(viewColumns('bk01_shop_entitlement_status'))).sort(), [
    'created_at',
    'is_active',
    'item_id',
    'item_kind',
    'item_name',
    'plan_entitled',
    'shop_id',
    'state',
    'system_disabled',
  ]);

  // No money value, no plan code and no limit number is selected by the surface.
  assert.doesNotMatch(viewSql, /\bprice\b|\bdeposit_amount\b|\bplan_code\b/i);
  assert.doesNotMatch(viewSql, /entitlement_plans/);
  assert.doesNotMatch(viewSql, /services_limit|staff_limit|shops_limit|auto_slip_limit/);
  // No customer data and no booking data.
  assert.doesNotMatch(viewSql, /local_service\.(?:customers|bookings|entitlement_usage|shop_users)\b/);
  // The only tables it reads are the two it reports on. Read as relations, not
  // as text: `FROM local_service.bk01_entitled_service_ids(svc.shop_id) AS e` is
  // a set-returning FUNCTION call, not a table, and a name scan over the view
  // text read its prefix `bk` as if it were one. The allowlist is the same two
  // objects, now written schema-qualified — which also makes a read of any OTHER
  // schema (ps01.*, storage.*) visible where the old text scan could not see it.
  assert.deepEqual(
    Array.from(new Set(relationNames(viewBody('bk01_shop_entitlement_status')))).sort(),
    ['local_service.services', 'local_service.staff'],
  );
});

// ---------------------------------------------------------------------------
// 10. F-12 / F-13 — the projections the signup reads as anon
// ---------------------------------------------------------------------------

test('F-12 anon reads the business-type projection and still cannot read the source table or any other object', () => {
  require_('GRANT SELECT ON TABLE local_service.app_business_types TO anon;');
  // The source table keeps the grant posture it had: no anon, no authenticated,
  // service_role only. The F-12 grant is on the view, not on the data.
  require_('REVOKE ALL ON TABLE local_service.business_types FROM anon, authenticated;');
  require_('GRANT ALL ON TABLE local_service.business_types TO service_role;');
  assert.doesNotMatch(
    sql,
    /\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?local_service\.business_types\b[^;]*\bTO\b[^;]*\b(?:anon|authenticated)\b/i,
  );
  // The shops table is not granted to anon by this file at all: the only table
  // grants for a client role here are the two projections and the frozen public
  // profile view.
  assert.doesNotMatch(
    sql,
    /\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?local_service\.shops\b[^;]*\bTO\b[^;]*\b(?:anon|authenticated)\b/i,
  );
  // No role is created or altered and no global default privilege is touched.
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE|EXTENSION|SCHEMA)\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i);

  // The anon-readable view is exactly the two projections F-12 and F-13 add, so
  // "anon can read this" is an enumerated list rather than a general opening.
  const anonGrantedViews = Array.from(sql.matchAll(/GRANT\s+SELECT\s+ON\s+TABLE\s+local_service\.([a-z_]+)\s+TO\s+([^;]+);/gi))
    .filter((match) => /\banon\b/i.test(match[2]))
    .map((match) => match[1])
    .sort();
  assert.deepEqual(anonGrantedViews, ['app_business_type_starter_services', 'app_business_types']);

  // ... and the projection's own columns are unchanged by F-12.
  const viewMatch = rawSql.match(/CREATE OR REPLACE VIEW local_service\.app_business_types AS([\s\S]*?);/);
  assert.ok(viewMatch, 'the type-list view must be in the file');
  assert.equal(squash(viewMatch[1]), 'SELECT type_code, emoji, label_th, label_en, display_order FROM local_service.business_types WHERE is_active = true ORDER BY display_order ASC, type_code ASC');
});

test('F-13 the starter-services projection is an allowlist of fields that exist and that provision_owner_shop uses', () => {
  require_('CREATE OR REPLACE VIEW local_service.app_business_type_starter_services AS');
  require_('REVOKE ALL ON TABLE local_service.app_business_type_starter_services FROM PUBLIC, anon, authenticated;');
  require_('GRANT SELECT ON TABLE local_service.app_business_type_starter_services TO anon;');
  // Inactive types are excluded, as provision_owner_shop excludes them.
  require_('WHERE bt.is_active = true');
  require_("COALESCE(bt.starter_pattern -> 'services', '[]'::JSONB)");

  const viewMatch = rawSql.match(
    /CREATE OR REPLACE VIEW local_service\.app_business_type_starter_services AS([\s\S]*?);\n\n/,
  );
  assert.ok(viewMatch, 'the starter-services projection must be in the file');
  const viewSql = squash(viewMatch[1]);

  // The exact four-column allowlist, read as the view's REAL declared column
  // list: this SELECT list is written across several lines and two of its four
  // items are expressions, so a reader that only understands a single-line list
  // of bare column names must not be the thing that decides this.
  const declaredColumns = viewColumns('app_business_type_starter_services');
  assert.deepEqual(declaredColumns, ['type_code', 'service_order', 'service_name', 'duration_minutes']);
  assert.deepEqual(Array.from(new Set(declaredColumns)).sort(), [
    'duration_minutes',
    'service_name',
    'service_order',
    'type_code',
  ]);

  // No price, no deposit, no staff_role_label and not the raw JSON column. The
  // last one is why the view extracts `->> 'name'` and `->> 'duration_minutes'`
  // instead of selecting starter_pattern: the JSONB column must not travel.
  assert.doesNotMatch(viewSql, /\bprice\b/i);
  assert.doesNotMatch(viewSql, /\bdeposit_amount\b/i);
  assert.doesNotMatch(viewSql, /\bstaff_role_label\b/i);
  assert.doesNotMatch(viewSql, /\bAS starter_pattern\b/i);
  assert.doesNotMatch(viewSql, /\bbt\.starter_pattern\b(?!\s*->\s*'services')/);
  require_("svc.value ->> 'name' AS service_name");
  require_("COALESCE((svc.value ->> 'duration_minutes')::INTEGER, 30) AS duration_minutes");

  // Every exposed field really exists: service_name and duration_minutes are the
  // two starter keys the seed actually carries, and they are exactly the two
  // expressions provision_owner_shop writes into services.
  const seededTypes = businessTypeRows.map((row) => unquote(row.type_code));
  for (const typeCode of seededTypes) {
    for (const service of starterServicesFor(typeCode)) {
      assert.equal(typeof service.serviceName, 'string');
      assert.ok(service.serviceName.length > 0, `${typeCode} starter service has no name`);
      assert.equal(Number.isInteger(service.durationMinutes), true);
    }
  }
  // There is no English name and no opening-hours data anywhere in the seed —
  // this asserts the ABSENCE the packet requires to be reported rather than
  // invented.
  for (const typeCode of seededTypes) {
    const row = businessTypeRows.find((candidate) => unquote(candidate.type_code) === typeCode);
    const pattern = parseStarterPattern((row as Record<string, string>).starter_pattern);
    assert.equal('name_en' in pattern, false, `${typeCode} must not carry name_en`);
    assert.equal('opening_hours' in pattern, false, `${typeCode} must not carry opening_hours`);
    for (const service of pattern.services) {
      assert.equal('name_en' in service, false);
      assert.equal('opening_hours' in service, false);
    }
  }
  // provision_owner_shop creates no opening hours either.
  const provisionStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.provision_owner_shop(');
  const provisionBody = rawSql.slice(provisionStart);
  assert.doesNotMatch(provisionBody, /opening_hours/i);
  assert.doesNotMatch(provisionBody, /INSERT INTO local_service\.(?:opening_hours|business_hours)/i);
});

test('F-13 the projected service list agrees row for row with what provision_owner_shop creates, capped by services_limit', () => {
  // Free is capped at 3 and every seeded type carries exactly 3 services, so the
  // cap is exercised by the 'other' type (1 service) versus the rest, and by
  // running the same comparison under a smaller cap.
  assert.equal(freeServicesLimit(), 3);
  assert.equal(Number(planRow('basic_490').services_limit), 50);

  for (const typeCode of businessTypeRows.map((row) => unquote(row.type_code))) {
    const projected = starterServicesFor(typeCode).map((row) => row.serviceName);
    // Under Basic (limit 50) the created list is the whole seeded list, in the
    // database's own JSON array order.
    assert.deepEqual(
      provisionedStarterNames(typeCode, Number(planRow('basic_490').services_limit)),
      projected,
      `${typeCode}: the created list must equal the projected list in order`,
    );
    // Under Free (limit 3) it is the same list truncated to 3 — the projection
    // is not pre-truncated by the view; the plan's cap is applied by
    // provision_owner_shop, which is why the view can serve any plan.
    assert.deepEqual(
      provisionedStarterNames(typeCode, freeServicesLimit()),
      projected.slice(0, freeServicesLimit()),
      `${typeCode}: free must create exactly the first 3 projected services`,
    );
    // ... and the created list is never longer than the cap.
    assert.ok(provisionedStarterNames(typeCode, freeServicesLimit()).length <= freeServicesLimit());
  }

  // The 'other' type has fewer services than the cap, so the cap does not add
  // anything that does not exist.
  assert.equal(starterServicesFor('other').length, 1);
  assert.deepEqual(provisionedStarterNames('other', freeServicesLimit()), ['บริการหลัก']);

  // The exact starter service list of the seeded barber type, read from the
  // seed, so a silent change to the projection or to the seed is caught.
  assert.deepEqual(starterServicesFor('barber'), [
    { typeCode: 'barber', serviceOrder: 0, serviceName: 'ตัดผมชาย', durationMinutes: 30 },
    { typeCode: 'barber', serviceOrder: 1, serviceName: 'ตัดผม สระ เซ็ต', durationMinutes: 60 },
    { typeCode: 'barber', serviceOrder: 2, serviceName: 'โกนหนวด', durationMinutes: 30 },
  ]);
  assert.deepEqual(provisionedStarterNames('barber', freeServicesLimit()), [
    'ตัดผมชาย',
    'ตัดผม สระ เซ็ต',
    'โกนหนวด',
  ]);
  // The view's ordering is the migration's: display_order, type_code, then the
  // array position — the same order provision_owner_shop consumes.
  require_('ORDER BY bt.display_order ASC, bt.type_code ASC, svc.ordinality ASC');
  require_('WITH ORDINALITY');
});

test('F-13 an inactive business type contributes no starter rows to either projection', () => {
  // Both views filter on the SAME active flag; the starter projection reads the
  // type row, so an inactive type is excluded exactly as app_business_types
  // excludes it. The type-list view's filter is asserted in section 10 above.
  require_('FROM local_service.business_types AS bt');
  require_('WHERE bt.is_active = true');
  // The projection only ever filters INACTIVE types OUT; there is no branch that
  // asks for inactive rows.
  assert.doesNotMatch(sql, /FROM local_service\.business_types(?:\s+AS\s+bt)?\s+WHERE\s+is_active\s*=\s*false/i);

  // provision_owner_shop applies the same restriction when it resolves the type,
  // so a type that is inactive cannot produce starter services at signup either.
  const provisionStart = rawSql.indexOf('CREATE OR REPLACE FUNCTION local_service.provision_owner_shop(');
  const provisionBody = rawSql.slice(provisionStart);
  assert.match(
    provisionBody,
    /FROM local_service\.business_types\s+WHERE type_code = v_type_code\s+AND is_active = true/,
  );

  // The projection is driven by the type row's active flag, so an inactive type
  // contributes zero rows by construction: model the view's own predicate.
  const projectionRows = (rows: Record<string, string>[]) =>
    rows
      .filter((row) => row.is_active === 'true')
      .flatMap((row) => starterServicesFor(unquote(row.type_code)));
  const activeSeed = businessTypeRows.filter((row) => row.is_active === 'true');
  assert.equal(activeSeed.length, businessTypeRows.length, 'every seeded type is active today');
  assert.equal(projectionRows(businessTypeRows).length, projectionRows(activeSeed).length);
  const withInactive = [...businessTypeRows, { type_code: "'sleeper'", is_active: 'false' }];
  assert.equal(
    projectionRows(withInactive).length,
    projectionRows(businessTypeRows).length,
    'an inactive type must add no starter rows',
  );
  assert.equal(withInactive.length, businessTypeRows.length + 1);
});
