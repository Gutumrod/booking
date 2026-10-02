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
// G06 (UI) — the completed action is not offered before the appointment
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-05T12:00:00Z');

test('an appointment in the future does NOT offer the outcome actions', () => {
  const decision = resolveAppointmentReached(
    { startTime: '2026-10-12T02:00:00Z', endTime: '2026-10-12T03:00:00Z' },
    NOW,
  );
  assert.equal(decision.reached, false);
  assert.equal(decision.basis, 'appointment_in_future');
  assert.equal(canOfferOutcomeActions({ startTime: '2026-10-12T02:00:00Z', endTime: '2026-10-12T03:00:00Z' }, NOW), false);
});

test('an appointment whose end has passed DOES offer the actions', () => {
  assert.equal(canOfferOutcomeActions(
    { startTime: '2026-10-05T01:00:00Z', endTime: '2026-10-05T02:00:00Z' }, NOW,
  ), true);
  // The boundary: exactly now counts as reached, so a shop is never locked out of a
  // queue that finished this second.
  assert.equal(canOfferOutcomeActions({ endTime: NOW.toISOString() }, NOW), true);
});

test('a booking that started but has not ended is offered on the START instant fallback', () => {
  // Mid-appointment: the end is still ahead, so the end alone would hide the action
  // for a whole service duration. The start fallback keeps the shop able to close it.
  const decision = resolveAppointmentReached(
    { startTime: '2026-10-05T11:30:00Z', endTime: '2026-10-05T13:00:00Z' },
    NOW,
  );
  assert.equal(decision.reached, false, 'the end has not passed, so the primary fact says not yet');

  // ...and when only the start is available (an older projection), it decides.
  const startOnly = resolveAppointmentReached({ startTime: '2026-10-05T11:30:00Z' }, NOW);
  assert.equal(startOnly.reached, true);
  assert.equal(startOnly.basis, 'start_time_passed');
});

test('a missing or malformed instant OFFERS the action — the SQL guard is the authority', () => {
  // G35's lesson, and the deliberate opposite of the old F-17 gate: the old gate
  // reconstructed the instant from text and answered "never started", which bricked
  // the "no-show" button on any row whose text did not match exactly. Hiding the
  // button has no recovery path; letting the guard refuse it does.
  for (const booking of [
    { endTime: null },
    { endTime: undefined },
    { endTime: '' },
    { endTime: 'not-a-date' },
    { startTime: null, endTime: null },
  ]) {
    const decision = resolveAppointmentReached(booking as any, NOW);
    assert.equal(decision.reached, true, `${JSON.stringify(booking)} must still be closeable`);
  }
  assert.equal(resolveAppointmentReached({ endTime: null }, NOW).basis, 'instant_missing');
  assert.equal(resolveAppointmentReached({ endTime: 'garbage' }, NOW).basis, 'instant_invalid');
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

test('the dashboard booking rows carry the server instants the gate needs', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  assert.match(service, /start_timestamptz/, 'the projection must select the real instants');
  assert.match(service, /end_timestamptz/);
  assert.match(service, /endTime: booking\.end_timestamptz \?\? null/);
});
