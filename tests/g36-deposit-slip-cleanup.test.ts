/**
 * G36, second half — "ไม่ล้างไฟล์ค้าง". The abort case for the upload-intent fix is
 * in `g36-upload-intent-abuse.test.ts`; this file is the other half of the finding:
 * an object that was uploaded through a signed URL but never passed to
 * `submit_deposit_slip` is referenced by nothing and is never deleted. It is the
 * residue the flood leaves behind, and the only safe way to remove it is a planner
 * that is destructive only on evidence.
 *
 * WHAT THESE CASES PROTECT. The dangerous direction for a cleaner is over-deletion:
 * a slip attached to a customer's booking IS the payment evidence for a dispute. So
 * every case here is written so that a *wrong* cleaner — one that deletes on age
 * alone, or treats an unidentifiable object as disposable — fails:
 *
 *   - a slip referenced by an ACTIVE booking is never deletable, however old it is;
 *   - a slip referenced by ANY booking is never deletable, active or not;
 *   - a slip that still has a live upload grant is not deletable (the customer may
 *     be mid-upload, and the grant table is the only record of that intent);
 *   - an object of unknown age is not deletable, because "we could not read the
 *     timestamp" is not evidence of staleness;
 *   - an object whose path does not match the deposit-slip contract is not
 *     deletable, because it is not ours to reason about.
 *
 * The planner is pure — it takes the facts (a storage inventory, the booking slip
 * references, the grant table) and returns a plan. The CLI in
 * `scripts/cleanup-stale-deposit-slips.mjs` is a thin wrapper over it and is a
 * dry-run unless it is told otherwise; both are exercised below.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const retention = await import('../scripts/lib/deposit-slip-retention.mjs');

const NOW = new Date('2026-10-02T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const GRANT_ACTIVE = '33333333-3333-4333-8333-333333333333';
const GRANT_EXPIRED = '44444444-4444-4444-8444-444444444444';

const path = (bookingId: string, objectId: string) => `${bookingId}/${objectId}.png`;
const oldEnough = new Date(NOW.getTime() - 72 * HOUR).toISOString();

const ACTIVE_SLIP = path(ACTIVE, GRANT_ACTIVE);
const CLOSED_SLIP = path(CLOSED, GRANT_EXPIRED);
const LIVE_GRANT_ORPHAN = path(GRANT_ACTIVE, '55555555-5555-4555-8555-555555555555');
const OLD_ORPHAN = path(GRANT_EXPIRED, '66666666-6666-4666-8666-666666666666');
const FRESH_ORPHAN = path(GRANT_EXPIRED, '77777777-7777-4777-8777-777777777777');
const UNKNOWN_AGE_ORPHAN = path(GRANT_EXPIRED, '88888888-8888-4888-8888-888888888888');

function fixture() {
  return {
    now: NOW,
    minAgeHours: 24,
    bookings: [
      { id: ACTIVE, status: 'confirmed', slip_url: ACTIVE_SLIP },
      { id: CLOSED, status: 'completed', slip_url: CLOSED_SLIP },
    ],
    grants: [
      { object_path: LIVE_GRANT_ORPHAN, expires_at: new Date(NOW.getTime() + 3 * 60 * 1000).toISOString() },
      { object_path: OLD_ORPHAN, expires_at: new Date(NOW.getTime() - 71 * HOUR).toISOString() },
    ],
    objects: [
      { name: ACTIVE_SLIP, created_at: oldEnough },
      { name: CLOSED_SLIP, created_at: oldEnough },
      { name: LIVE_GRANT_ORPHAN, created_at: oldEnough },
      { name: OLD_ORPHAN, created_at: oldEnough },
      { name: FRESH_ORPHAN, created_at: new Date(NOW.getTime() - 1 * HOUR).toISOString() },
      { name: UNKNOWN_AGE_ORPHAN, created_at: null },
      { name: 'not-a-slip-path.png', created_at: oldEnough },
    ],
  };
}

test('a slip bound to an active booking is never deletable, however old it is', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  const paths = plan.deletable.map((entry: { path: string }) => entry.path);
  assert.ok(!paths.includes(ACTIVE_SLIP), 'a live booking lost its payment evidence');
  const entry = plan.kept.find((item: { path: string }) => item.path === ACTIVE_SLIP);
  assert.equal(entry?.reason, 'bound-to-active-booking');
});

test('a slip bound to any booking is kept, so a closed booking keeps its receipt', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  const entry = plan.kept.find((item: { path: string }) => item.path === CLOSED_SLIP);
  assert.ok(!plan.deletable.some((item: { path: string }) => item.path === CLOSED_SLIP));
  assert.equal(entry?.reason, 'bound-to-booking');
});

test('an unsubmitted upload with a live grant is kept, because the customer may be mid-upload', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  assert.ok(!plan.deletable.some((item: { path: string }) => item.path === LIVE_GRANT_ORPHAN));
  assert.equal(
    plan.kept.find((item: { path: string }) => item.path === LIVE_GRANT_ORPHAN)?.reason,
    'upload-grant-still-live',
  );
});

test('an orphan past the grace window and with no live grant is the only thing planned for deletion', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  assert.deepEqual(
    plan.deletable.map((entry: { path: string }) => entry.path),
    [OLD_ORPHAN],
    'the plan must contain exactly the one object that is both orphaned and past grace',
  );
});

test('an unreadable timestamp is not evidence of staleness', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  assert.ok(!plan.deletable.some((item: { path: string }) => item.path === UNKNOWN_AGE_ORPHAN));
  assert.equal(
    plan.kept.find((item: { path: string }) => item.path === UNKNOWN_AGE_ORPHAN)?.reason,
    'age-unknown',
  );
});

test('a fresh orphan inside the grace window is kept', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  assert.ok(!plan.deletable.some((item: { path: string }) => item.path === FRESH_ORPHAN));
  assert.equal(
    plan.kept.find((item: { path: string }) => item.path === FRESH_ORPHAN)?.reason,
    'inside-grace-window',
  );
});

test('an object whose path is not the deposit-slip contract is not ours to delete', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  assert.ok(!plan.deletable.some((item: { path: string }) => item.path === 'not-a-slip-path.png'));
  assert.equal(
    plan.kept.find((item: { path: string }) => item.path === 'not-a-slip-path.png')?.reason,
    'unrecognised-path-shape',
  );
});

test('the plan is self-consistent: nothing deletable is referenced by a booking', () => {
  const plan = retention.planDepositSlipCleanup(fixture());
  const referenced = new Set<string>([ACTIVE_SLIP, CLOSED_SLIP]);
  for (const entry of plan.deletable) {
    assert.ok(!referenced.has(entry.path), `${entry.path} is referenced by a booking and must not be deletable`);
  }
  assert.equal(plan.summary.inspected, 7);
  assert.equal(plan.summary.deletable, 1);
  assert.equal(plan.summary.kept, 6);
});

test('a plan with a negative or missing grace window is refused', () => {
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...fixture(), minAgeHours: 0 }),
    /minAgeHours/,
  );
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...fixture(), minAgeHours: undefined }),
    /minAgeHours/,
  );
});

/*
 * F2 (opencode MEDIUM, AGY MEDIUM). The planner used to read a missing key as an
 * empty list. With `bookings` absent, `referencedPaths` was empty and a slip that a
 * customer's booking still points at became "orphaned" — the one guarantee this tool
 * exists to keep, defeated by a typo in the operator's facts file, with a plausible
 * sha256 printed for `--apply`. Missing evidence must never read as "safe to delete":
 * an absent or non-array `bookings`/`grants` is refused outright, and an unreadable
 * grant expiry counts as live (KEEP), not as expired.
 */
function factsFrom(source: Record<string, unknown>) {
  const facts: Record<string, unknown> = {
    objects: source.objects,
    bookings: source.bookings,
    grants: source.grants,
  };
  for (const key of Object.keys(facts)) {
    if (facts[key] === undefined) delete facts[key];
  }
  return facts;
}

test('facts without a bookings list are refused, not read as "no booking references anything"', () => {
  const { bookings: _omitted, ...withoutBookings } = factsFrom(fixture());
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...withoutBookings, minAgeHours: 24, now: NOW }),
    /bookings/,
    'an absent bookings list must not become an empty one',
  );
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...factsFrom(fixture()), bookings: null, minAgeHours: 24, now: NOW }),
    /bookings/,
    'a null bookings list must not become an empty one',
  );
});

test('facts without a grants list are refused, so a live upload cannot look expired', () => {
  const { grants: _omitted, ...withoutGrants } = factsFrom(fixture());
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...withoutGrants, minAgeHours: 24, now: NOW }),
    /grants/,
    'an absent grants list must not become an empty one',
  );
  assert.throws(
    () => retention.planDepositSlipCleanup({ ...factsFrom(fixture()), grants: null, minAgeHours: 24, now: NOW }),
    /grants/,
    'a null grants list must not become an empty one',
  );
});

test('a grant whose expiry cannot be read stops the plan instead of being treated as expired', () => {
  const facts = factsFrom(fixture());
  assert.throws(
    () => retention.planDepositSlipCleanup({
      ...facts,
      grants: [...(facts.grants as unknown[]), { object_path: FRESH_ORPHAN.replace('77777777', '99999999'), expires_at: 'not-a-date' }],
      minAgeHours: 24,
      now: NOW,
    }),
    /grants\[2\]\.expires_at/,
    'an unreadable grant expiry is not evidence that the grant is dead',
  );
  assert.throws(
    () => retention.planDepositSlipCleanup({
      ...facts,
      grants: [{ object_path: FRESH_ORPHAN.replace('77777777', '99999999') }],
      minAgeHours: 24,
      now: NOW,
    }),
    /grants\[0\]\.expires_at/,
    'a grant with no expiry at all is not evidence that the grant has expired',
  );
});

test('an objects list that is absent or not an array is refused', () => {
  assert.throws(
    () => retention.planDepositSlipCleanup({ bookings: [], grants: [], minAgeHours: 24, now: NOW }),
    /objects/,
  );
  assert.throws(
    () => retention.planDepositSlipCleanup({ objects: {}, bookings: [], grants: [], minAgeHours: 24, now: NOW }),
    /objects/,
  );
});

/*
 * The CLI is the part an operator actually runs, so the safety property has to hold
 * there too. These two cases read the tool's own output rather than its source.
 */
function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ['scripts/cleanup-stale-deposit-slips.mjs', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('the cleanup script is a dry-run unless it is told otherwise, and it deletes nothing', () => {
  const repoRoot = join(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'g36-cleanup-'));
  try {
    const planFile = join(dir, 'plan.json');
    const facts = fixture();
    writeFileSync(planFile, JSON.stringify({
      objects: facts.objects,
      bookings: facts.bookings,
      grants: facts.grants,
    }));
    const before = readFileSync(planFile, 'utf8');

    const result = runCli(['--facts', planFile, '--min-age-hours', '24', '--now', NOW.toISOString()], repoRoot);
    assert.equal(result.status, 0, `dry run must succeed, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /DRY RUN/, 'an operator must be told this was a dry run');
    assert.match(result.stdout, /deletable/i);
    assert.equal(readFileSync(planFile, 'utf8'), before, 'the dry run must not touch its input');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cleanup script refuses to plan without an explicit grace window', () => {
  const repoRoot = join(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'g36-cleanup-'));
  try {
    const planFile = join(dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ objects: [], bookings: [], grants: [] }));
    const result = runCli(['--facts', planFile], repoRoot);
    assert.notEqual(result.status, 0, 'a default grace window would delete on a guess');
    assert.match(`${result.stdout}${result.stderr}`, /min-age-hours/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cleanup script refuses facts that omit the booking list instead of planning a deletion', () => {
  const repoRoot = join(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'g36-cleanup-'));
  try {
    const planFile = join(dir, 'plan.json');
    const facts = fixture();
    writeFileSync(planFile, JSON.stringify({ objects: facts.objects, grants: facts.grants }));
    const result = runCli(['--facts', planFile, '--min-age-hours', '24', '--now', NOW.toISOString()], repoRoot);
    assert.notEqual(result.status, 0, 'facts missing the booking list must not produce an actionable plan');
    assert.match(`${result.stdout}${result.stderr}`, /bookings/);
    assert.doesNotMatch(`${result.stdout}`, /delete /, 'no deletion may be planned from facts that cannot prove a slip is orphaned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
