/**
 * BK01 P0 — application unit H6 (council findings G34, G32, G06-on-the-UI).
 *
 * THREE THINGS, ONE UNIT:
 *
 *  G34 — "Free = 5 services" must be what every surface SAYS, not just what the
 *  contract file holds. The DB was already moved to 5 by the SQL set; the app copy
 *  and the signup mirror were not, so a Free shop was told 3 and the signup promised
 *  3 starter services.
 *
 *  G32 — `[[OWNER INPUT …]]` placeholders are visible on the legal pages today (21 of
 *  them in each locale). The gate `scripts/check-owner-input-placeholders.mjs` now
 *  scans the rendered message files and fails when one is present; it runs at warning
 *  level until CP3 because the legal wording is still with the lawyer, and the SAME
 *  scan is what fails later — so enabling it changes nothing about what is measured.
 *
 *  G06 (UI) — the "completed" button was shown on any confirmed booking, including one
 *  whose appointment is days away. The shop could mark it done, which freed the slot
 *  and let another customer book over it. The SQL guard now refuses that; this side
 *  hides the action instead of offering one that will be refused.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canOfferOutcomeActions,
  resolveAppointmentReached,
} from '../apps/booking-admin/src/lib/booking-outcome-gate.ts';
import { SIGNUP_PLAN_SERVICES_LIMIT } from '../apps/booking-admin/src/lib/business-type-starter-services.ts';

const read = (path: string) => readFileSync(path, 'utf8');

// ---------------------------------------------------------------------------
// G34 — Free is 5 everywhere the user reads it
// ---------------------------------------------------------------------------

test('Free is 5 services in the contract and in the signup mirror, and the copy says 5', async () => {
  assert.equal(SIGNUP_PLAN_SERVICES_LIMIT.free_trial, 5, 'the signup must offer what A-21 sells');
  const { FREE_PLAN_SERVICES } = await import('../apps/booking-admin/src/lib/commercial-contract.ts');
  assert.equal(FREE_PLAN_SERVICES, 5);
});

test('no rendered message file still advertises a 3-service Free plan', () => {
  for (const path of [
    'apps/booking-consumer/messages/th.json',
    'apps/booking-consumer/messages/en.json',
    'apps/booking-admin/messages/th.json',
    'apps/booking-admin/messages/en.json',
  ]) {
    const json = JSON.parse(read(path)) as Record<string, unknown>;
    const blob = JSON.stringify(json);
    assert.doesNotMatch(blob, /3\s*บริการ/, `${path} still tells the user 3 บริการ`);
    assert.doesNotMatch(blob, /\b3\s*services\b/, `${path} still tells the user 3 services`);
  }
});

test('the signup preview comment and the mirror agree with the contract', () => {
  const register = read('apps/booking-admin/src/app/register/page.tsx');
  assert.doesNotMatch(register, /at most 3 services/);
  const mirror = read('apps/booking-admin/src/lib/business-type-starter-services.ts');
  assert.match(mirror, /free_trial:\s*5/);
});

// ---------------------------------------------------------------------------
// G32 — the placeholder gate
// ---------------------------------------------------------------------------

test('the owner-input gate scans the rendered message files and reports every hit', () => {
  const output = execFileSync(process.execPath, ['scripts/check-owner-input-placeholders.mjs'], { encoding: 'utf8' });
  // Scanned files are named, so a run that scanned nothing could not look like a pass.
  // Path separators differ by platform, so match the file names.
  assert.match(output, /messages[\\/]th\.json/);
  assert.match(output, /messages[\\/]en\.json/);
  assert.match(output, /Owner-input placeholders in rendered copy: \d+/);
  assert.match(output, /scanned 4 rendered message file\(s\)/, 'both apps, both locales');
});

test('the gate exits non-zero under --enforce, and the warning run exits zero', () => {
  // The scan is identical; only the exit code differs. Proving both means the switch
  // to enforcement before CP3 is a flag flip, not a second implementation.
  const warn = execFileSync(process.execPath, ['scripts/check-owner-input-placeholders.mjs'], { encoding: 'utf8' });
  assert.match(warn, /WARN \(enforcement off\)/);

  let enforcedFailed = false;
  try {
    execFileSync(process.execPath, ['scripts/check-owner-input-placeholders.mjs', '--enforce'], { encoding: 'utf8' });
  } catch {
    enforcedFailed = true;
  }
  assert.ok(
    enforcedFailed,
    'the gate must FAIL while placeholders are still visible — a gate that cannot fail is the defect G30 describes',
  );
});

test('the gate is wired into the package scripts so a release run can call it', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['gate:owner-input'], 'node scripts/check-owner-input-placeholders.mjs');
  assert.equal(pkg.scripts['gate:owner-input:enforce'], 'node scripts/check-owner-input-placeholders.mjs --enforce');
});

// ---------------------------------------------------------------------------
// G06 (UI) — the completed/no-show actions open when the appointment STARTS,
// the same instant the SQL guard tests, and are hidden only before the start
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-05T12:00:00Z');

test('an appointment that has not started (start still in the future) does NOT offer the actions', () => {
  const booking = { startTime: '2026-10-12T02:00:00Z', endTime: '2026-10-12T03:00:00Z' };
  const decision = resolveAppointmentReached(booking, NOW);
  assert.equal(decision.reached, false);
  assert.equal(decision.basis, 'start_time_in_future');
  assert.equal(canOfferOutcomeActions(booking, NOW), false);
});

test('an appointment that has STARTED (start past, end still future) DOES offer the actions', () => {
  // THE BEHAVIOURAL CHANGE: the authority opens the action when the appointment
  // STARTS, so mid-appointment the shop may already mark completed/no-show. The old
  // test asserted the opposite because it keyed off the end instant.
  const booking = { startTime: '2026-10-05T11:30:00Z', endTime: '2026-10-05T13:00:00Z' };
  const decision = resolveAppointmentReached(booking, NOW);
  assert.equal(decision.reached, true);
  assert.equal(decision.basis, 'start_time_reached');
  assert.equal(canOfferOutcomeActions(booking, NOW), true);
  // The boundary: exactly now counts as started, so a shop is never locked out of a
  // queue that starts this second.
  assert.equal(canOfferOutcomeActions({ startTime: NOW.toISOString() }, NOW), true);
});

test('an appointment that has finished DOES offer the actions', () => {
  assert.equal(canOfferOutcomeActions(
    { startTime: '2026-10-05T01:00:00Z', endTime: '2026-10-05T02:00:00Z' }, NOW,
  ), true);
  // When the start is missing, the end instant is the fallback that decides.
  const fallback = resolveAppointmentReached({ endTime: '2026-10-05T02:00:00Z' }, NOW);
  assert.equal(fallback.reached, true);
  assert.equal(fallback.basis, 'end_time_reached_fallback');
  // ...and an end still ahead with no usable start is NOT offered.
  assert.equal(canOfferOutcomeActions({ endTime: '2026-10-05T13:00:00Z' }, NOW), false);
});

test('a booking with no usable instant still OFFERS the action — the SQL guard is the authority', () => {
  // G35's lesson, and the deliberate fail direction: hiding the button on a row whose
  // instants are unreadable has no recovery path, whereas the guard can refuse it.
  for (const booking of [
    { startTime: null, endTime: null },
    { startTime: undefined, endTime: undefined },
    { startTime: '', endTime: '' },
    { startTime: 'not-a-date' },
    { endTime: null },
    { endTime: 'not-a-date' },
  ]) {
    const decision = resolveAppointmentReached(booking as any, NOW);
    assert.equal(decision.reached, true, `${JSON.stringify(booking)} must still be closeable`);
  }
  assert.equal(resolveAppointmentReached({ startTime: null, endTime: null }, NOW).basis, 'instant_missing');
  assert.equal(resolveAppointmentReached({ startTime: 'garbage' }, NOW).basis, 'instant_invalid');
  assert.equal(resolveAppointmentReached({ startTime: null, endTime: 'garbage' }, NOW).basis, 'instant_invalid');
});

test('the gate reads the SERVER instant and never re-parses the display text', () => {
  // Comments in this file name the F-17 defect on purpose, so only CODE is checked.
  const code = read('apps/booking-admin/src/lib/booking-outcome-gate.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // The F-17 defect, in one line each: reconstruct an instant by string-matching the
  // display columns and applying a hard-coded Bangkok offset. The replacement reads
  // `endTime`/`startTime`, which the service layer fills from the real timestamptz.
  assert.doesNotMatch(code, /\+07:00/, 'the gate must not reconstruct an instant with a guessed offset');
  assert.doesNotMatch(code, /booking_date/, 'the gate must not parse the date display column');
  assert.doesNotMatch(code, /startTime\.slice|timeMatch|\\d\{2\}:\d\{2\}/, 'the gate must not parse a time string');
});

test('the dashboard offers the outcome actions only when the gate says so', () => {
  const dashboard = read('apps/booking-admin/src/app/dashboard/page.tsx');
  assert.match(
    dashboard,
    /b\.status === 'confirmed' && shopRole !== 'staff' && canOfferOutcomeActions\(b\)/,
    'the confirmed-status branch must also require the timing gate',
  );
  assert.match(dashboard, /from '@\/lib\/booking-outcome-gate'/);
});

// The dashboard projection must be checked against the REAL query, not against loose
// text. A mutation that drops `start_timestamptz,` from the select list leaves the
// token `start_timestamptz` present on the mapping line, so `assert.match(service,
// /start_timestamptz/)` survives — the exact vacuity the reviewer caught. These two
// helpers parse the query instead of grepping the file.

// PARSE the top-level select column list out of the bookings query inside the
// exported `fetchAdminDashboardData`. The list is a template literal; split it on
// commas at DEPTH 0 only, because embedded relation projections such as
// `customers ( name, phone )` carry their own commas and are not top-level columns.
function parseBookingsSelectColumns(service: string): {
  projection: string;
  columns: string[];
  relationProjections: string[];
} {
  const fnStart = service.indexOf('export async function fetchAdminDashboardData');
  assert.notEqual(fnStart, -1, 'fetchAdminDashboardData must exist — the test binds to the real query');
  const fnEnd = service.indexOf('\nexport ', fnStart + 1);
  const fn = service.slice(fnStart, fnEnd === -1 ? service.length : fnEnd);

  const fromIndex = fn.indexOf(".from('bookings')");
  assert.notEqual(fromIndex, -1, "the dashboard function must query .from('bookings')");
  const selectIndex = fn.indexOf('.select(', fromIndex);
  assert.notEqual(selectIndex, -1, 'the bookings query must project a column list');

  const selectOpen = selectIndex + '.select('.length;
  assert.equal(fn[selectOpen], '`', 'the bookings projection must be a template literal');
  const templateEnd = fn.indexOf('`', selectOpen + 1);
  assert.notEqual(templateEnd, -1, 'the projection template literal must close');
  const projection = fn.slice(selectOpen + 1, templateEnd);

  const columns: string[] = [];
  const relationProjections: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const entry = current.trim();
    if (entry.length > 0) {
      if (depth === 0 && !entry.includes('(')) columns.push(entry);
      else relationProjections.push(entry);
    }
    current = '';
  };
  for (const char of projection) {
    if (char === '(') {
      depth += 1;
      current += char;
    } else if (char === ')') {
      depth -= 1;
      current += char;
    } else if (char === ',' && depth === 0) {
      flush();
    } else {
      current += char;
    }
  }
  flush();

  return { projection, columns, relationProjections };
}

// Anchor the mapping assertions to the bookings map callback itself, so a `startTime:`
// line anywhere else in the file cannot satisfy them.
function isolateBookingMappingBlock(service: string): string {
  const mapMatch = /RawBooking\[\]\)\.map\(\(booking\) => \{/.exec(service);
  assert.ok(mapMatch, 'the dashboard must map RawBooking rows into DashboardBooking');
  const mapIndex = mapMatch.index;
  const satisfiesIndex = service.indexOf('satisfies DashboardBooking', mapIndex);
  assert.notEqual(satisfiesIndex, -1, 'the bookings mapping must return a DashboardBooking');
  return service.slice(mapIndex, satisfiesIndex);
}

test('the dashboard booking rows carry the server instants the gate needs', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  const { columns, relationProjections } = parseBookingsSelectColumns(service);

  console.log(`[H6] parsed bookings select columns: ${JSON.stringify(columns)}`);

  // (a) the parsed top-level column list carries BOTH real instants the gate reads.
  assert.ok(columns.length >= 8, `the select list must parse into real columns, got ${columns.length}`);
  assert.ok(columns.includes('start_timestamptz'), 'the bookings projection must select the server start instant');
  assert.ok(columns.includes('end_timestamptz'), 'the bookings projection must select the server end instant');

  // The embedded relation projections are recognised and kept out of the column list.
  assert.deepEqual(relationProjections.map((entry) => entry.split('(')[0].trim()), ['customers', 'services', 'staff']);

  // (b) the retired column is NOT selected by the bookings query.
  assert.ok(!columns.includes('line_oa_id'), 'the bookings query must not select the retired line_oa_id');

  // (c) the projection still maps the server instants, anchored to the mapping block.
  const mapping = isolateBookingMappingBlock(service);
  assert.match(mapping, /startTime: booking\.start_timestamptz \?\? null/, 'startTime must pass through the server start instant');
  assert.match(mapping, /endTime: booking\.end_timestamptz \?\? null/, 'endTime must pass through the server end instant');
});
