// Reproduces the four concrete examples Codex used to fail round 2 (H1 not closed),
// by loading canRecordRefund() from WHATEVER refund-eligibility.ts is in the given
// repo root. Same script proves fail-before (tip 00ccf38) and pass-after.
//
// Usage: node evidence/reproduce-h1-round2.mjs [repo-root]
//        (default: this file's repo root)
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const eligibility = `${root}/apps/booking-admin/src/lib/refund-eligibility.ts`;
const spec = `${root}/evidence/b8-spec-v2-addendum-for-group5.sql`;
if (!existsSync(eligibility)) throw new Error(`cannot reproduce: ${eligibility} not found`);

const mod = await import(pathToFileURL(eligibility).href);
const { canRecordRefund } = mod;
const lists = mod.SETTLED_QUEUE_STATUSES ?? mod.RELEASED_QUEUE_STATUSES ?? [];

const NOW = '2026-10-01T17:00:00+07:00';
const PAST = '2026-10-01T16:00:00+07:00';
const FUTURE = '2026-10-01T20:00:00+07:00';

const cases = [
  ['expired, appointment still ahead -> must stay CLOSED (Codex r2: app opened it)',
    { status: 'expired', depositStatus: 'verified', endTime: FUTURE }, false],
  ['expired, appointment already ended -> must OPEN',
    { status: 'expired', depositStatus: 'verified', endTime: PAST }, true],
  ['confirmed, appointment already ended -> must OPEN (Codex r2: app hid it)',
    { status: 'confirmed', depositStatus: 'verified', endTime: PAST }, true],
  ['hold, appointment already ended -> must OPEN (Codex r2: app hid it)',
    { status: 'hold', depositStatus: 'verified', endTime: PAST }, true],
  ['confirmed, appointment in the future -> must stay CLOSED',
    { status: 'confirmed', depositStatus: 'verified', endTime: FUTURE }, false],
  ['cancelled + deposit_status=rejected (persisted refusal) -> must stay CLOSED (Codex r2: r1 fixture used a booking status of rejected)',
    { status: 'cancelled', depositStatus: 'rejected', endTime: FUTURE }, false],
  ['hold + deposit_status=rejected (how a refusal really persists) -> must stay CLOSED',
    { status: 'hold', depositStatus: 'rejected', endTime: FUTURE }, false],
];

let failures = 0;
console.log(`repo root : ${root}`);
console.log(`spec file : ${existsSync(spec) ? spec : '(absent on this revision)'}`);
console.log(`status list exported (settled/released) : [${lists.join(', ')}]`);
console.log('');
for (const [name, booking, expected] of cases) {
  const actual = canRecordRefund({ ...booking, date: '2026-10-01', time: '14:00', durationMinutes: 120 }, NOW);
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}\n     actual=${actual} expected=${expected}`);
}
console.log(`\nfailures: ${failures}`);
console.log(failures === 0
  ? 'RESULT: all round-2 H1 expectations satisfied'
  : 'RESULT: round-2 H1 defects reproduced');
process.exit(failures === 0 ? 0 : 1);
