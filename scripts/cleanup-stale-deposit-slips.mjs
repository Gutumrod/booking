/**
 * G36, second half — stale deposit-slip object clean-up. OPERATOR TOOL.
 *
 * WHAT IT IS FOR. `authorize_deposit_slip_upload` hands out a signed upload URL for
 * every call with a live booking token, and nothing obliges the caller to finish the
 * job. An object uploaded through such a URL but never passed to `submit_deposit_slip`
 * is referenced by no row at all: `bookings.slip_url` never learns about it and its
 * authorising grant has long expired. At 5 MB a request that residue is a storage
 * leak. This tool plans its removal. The admission-control half of the same finding
 * is fixed in the app (`apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts`).
 *
 * SAFETY. Dry run is the default and the only thing that runs without an explicit,
 * pinned instruction:
 *   - it never deletes a slip that any booking refers to, at any age;
 *   - it never deletes a slip whose upload grant is still live;
 *   - it never deletes an object whose age it cannot read;
 *   - it never deletes an object whose path is not the deposit-slip shape;
 *   - `--apply` additionally requires the sha256 of the plan it already printed, so an
 *     operator cannot apply a plan they have not looked at.
 *
 * WHAT IT CANNOT DO. Nothing here runs SQL and nothing here touches Supabase
 * configuration. Deletion goes to the Storage HTTP API for exactly the planned object
 * paths. A durable, scheduled purge inside the database needs House-owned scope and is
 * deliberately NOT implemented — see the contract note handed to Codex.
 *
 * USAGE (dry run)
 *   node scripts/cleanup-stale-deposit-slips.mjs --facts <facts.json> --min-age-hours 24
 *
 * USAGE (execute, requires a reviewed plan)
 *   BK01_CLEANUP_SUPABASE_URL=... BK01_CLEANUP_SERVICE_KEY=... \
 *   node scripts/cleanup-stale-deposit-slips.mjs --facts facts.json --min-age-hours 24 \
 *     --apply --confirm-plan <sha256 printed by the dry run>
 *
 * FACTS FORMAT (an operator with database read access produces this; the tool reads
 * no credential and no database itself):
 *   {
 *     "objects":  [{ "name": "<booking_uuid>/<grant_uuid>.<ext>", "created_at": "<iso>" }],
 *     "bookings": [{ "id": "<uuid>", "status": "hold|pending_review|confirmed|…", "slip_url": "<path>|null" }],
 *     "grants":   [{ "object_path": "<path>", "expires_at": "<iso>" }]
 *   }
 *
 * The service key is never printed, never logged and never written to the plan.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { planDepositSlipCleanup, formatPlan } from './lib/deposit-slip-retention.mjs';

const BUCKET = 'deposit-slips';

function fail(message) {
  process.stderr.write(`cleanup-stale-deposit-slips: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { facts: null, minAgeHours: null, apply: false, confirmPlan: null, now: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') { options.apply = true; continue; }
    if (!['--facts', '--min-age-hours', '--confirm-plan', '--now', '--out'].includes(arg)) {
      fail(`unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${arg} requires a value`);
    index += 1;
    if (arg === '--facts') options.facts = value;
    if (arg === '--out') options.out = value;
    if (arg === '--now') options.now = value;
    if (arg === '--confirm-plan') options.confirmPlan = value;
    if (arg === '--min-age-hours') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) fail('--min-age-hours must be a number');
      options.minAgeHours = parsed;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!options.facts) {
  fail('--facts <file> is required. This tool never reads a database or a bucket by itself.');
}
if (options.minAgeHours === null) {
  /*
   * No default. The retention period is an Owner/legal decision that has not been
   * made (council G33), and a hard-coded fallback would silently become policy.
   */
  fail('--min-age-hours is required; there is no default. The retention period is an Owner decision.');
}
if (options.apply && !options.confirmPlan) {
  fail('--apply requires --confirm-plan <sha256> from a reviewed dry run.');
}

let facts;
try {
  facts = JSON.parse(readFileSync(options.facts, 'utf8'));
} catch (error) {
  fail(`cannot read facts file ${options.facts}: ${error.message}`);
}

let plan;
try {
  plan = planDepositSlipCleanup({
    objects: facts.objects,
    bookings: facts.bookings,
    grants: facts.grants,
    now: options.now ?? new Date(),
    minAgeHours: options.minAgeHours,
  });
} catch (error) {
  fail(error.message);
}

/** The plan digest an operator pins with `--confirm-plan`. */
const planSha256 = createHash('sha256')
  .update(JSON.stringify(plan.deletable.map((entry) => entry.path).sort()))
  .digest('hex');

process.stdout.write(`${formatPlan(plan, { dryRun: !options.apply })}\n`);
process.stdout.write(`plan sha256 (paths only): ${planSha256}\n`);

if (options.out) {
  writeFileSync(options.out, `${JSON.stringify({ planSha256, ...plan }, null, 2)}\n`);
  process.stdout.write(`plan written to ${options.out}\n`);
}

if (!options.apply) process.exit(0);

if (options.confirmPlan !== planSha256) {
  fail('--confirm-plan does not match this plan; re-run the dry run and review the paths it lists.');
}

const supabaseUrl = process.env.BK01_CLEANUP_SUPABASE_URL?.trim();
const serviceKey = process.env.BK01_CLEANUP_SERVICE_KEY?.trim();
if (!supabaseUrl || !serviceKey) {
  fail('--apply needs BK01_CLEANUP_SUPABASE_URL and BK01_CLEANUP_SERVICE_KEY in the environment.');
}
if (plan.deletable.length === 0) {
  process.stdout.write('nothing to delete.\n');
  process.exit(0);
}

let deleted = 0;
let failed = 0;
for (const entry of plan.deletable) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${entry.path}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
  } catch (error) {
    failed += 1;
    process.stderr.write(`  delete failed ${entry.path}: ${error.message}\n`);
    continue;
  }
  if (response.ok || response.status === 404) {
    deleted += 1;
    process.stdout.write(`  deleted ${entry.path}\n`);
  } else {
    failed += 1;
    process.stderr.write(`  delete failed ${entry.path}: HTTP ${response.status}\n`);
  }
}

process.stdout.write(`\ndeleted ${deleted}; failed ${failed}; kept ${plan.kept.length}\n`);
if (failed > 0) process.exit(1);
