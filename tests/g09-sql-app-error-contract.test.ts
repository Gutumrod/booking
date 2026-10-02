/**
 * G09/L-01 — the SQL↔app error contract, read from BOTH sides instead of trusted.
 *
 * THE HOLE THIS CLOSES (reviewer L-01). The daily upload-intent ceiling is recognised
 * on the app side by matching the RPC's error MESSAGE, exactly:
 *
 *     apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts
 *       UPLOAD_INTENT_DAILY_LIMIT_SQL_MESSAGE = 'UPLOAD_INTENT_LIMIT'
 *       isDailyUploadLimit(): message.trim() === UPLOAD_INTENT_DAILY_LIMIT_SQL_MESSAGE
 *
 * Every test that existed before this file pinned that rule against a HAND-WRITTEN
 * copy of the message (`SQL_DAILY_LIMIT_MESSAGE` in `g09-upload-intent-limit-map.test.ts`).
 * So the two halves of the contract — the string the SQL raises and the string the app
 * compares — could drift apart with every test still green, and the customer would read
 * "Invalid or expired booking capability" instead of the quota refusal. Nothing in the
 * suite read the migration. This file does: it parses the `RAISE EXCEPTION USING ...`
 * the RPC actually ships, and holds the app constant against THAT.
 *
 * WHY THE MESSAGE AND NOT THE CODE. See the app constant's own comment: every refusal in
 * this RPC shares ERRCODE `P0001`, so the code separates nothing and only the exact
 * message does. The code is still asserted, because the app's mapping is only reachable
 * through the grant-less error branch and a change of code is a change of contract.
 *
 * WHY A FILE READ AND NOT A DATABASE CONNECTION. There is no BK01 product database login
 * on a workstation (see `supabase/bk01-migrations/README.md`), so the migration source is
 * the only authoritative copy of the string available to a test. The path is resolved in
 * the order the task fixed: `BK01_G09_SQL`, then this branch, then the authoring
 * worktree. NO SILENT SKIP — if none of them exists the file throws and names every path
 * it tried, because a contract test that skips is a contract test that lies.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The migration that carries the ceiling; G09/G10, owner-approved P1 remediation. */
const SQL_FILE_NAME = '20261002150000_bk01_p1_g09_g10.sql';
/** Where this branch will have it once the Codex side is merged. */
const REPO_SQL_PATH = path.join(REPO_ROOT, 'supabase', 'bk01-migrations', SQL_FILE_NAME);
/** Where it is authored today, while it is not yet in this branch's own tree. */
const AUTHORING_SQL_PATH =
  'D:/AI-Workspace/runtime/worktrees/bk01-p1-g09-g10-20261002/supabase/bk01-migrations/' + SQL_FILE_NAME;

/** The RPC whose refusal the app translates. */
const RPC = 'authorize_deposit_slip_upload';
/** The code the app's mapping is written against. */
const EXPECTED_ERRCODE = 'P0001';
/** Marks the raises of, or about, the upload-intent ceiling. */
const UPLOAD_INTENT_MARKER = 'UPLOAD_INTENT';

function resolveSqlPath(): string {
  const candidates: Array<{ source: string; file: string }> = [];
  const override = process.env.BK01_G09_SQL?.trim();
  if (override) candidates.push({ source: 'env BK01_G09_SQL', file: override });
  candidates.push({ source: 'this branch (supabase/bk01-migrations)', file: REPO_SQL_PATH });
  candidates.push({ source: 'authoring worktree (bk01-p1-g09-g10-20261002)', file: AUTHORING_SQL_PATH });

  for (const candidate of candidates) {
    if (existsSync(candidate.file)) return candidate.file;
  }
  throw new Error(
    'G09 SQL↔app contract test: no migration file found, so the contract cannot be checked.\n'
      + 'Set BK01_G09_SQL to the migration, or place it in supabase/bk01-migrations/.\n'
      + 'Paths tried:\n'
      + candidates.map((candidate) => `  - ${candidate.source}: ${candidate.file}`).join('\n'),
  );
}

const SQL_PATH = resolveSqlPath();
const SQL = readFileSync(SQL_PATH, 'utf8');
const app = await import('../apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts');

/** The body of one `CREATE OR REPLACE FUNCTION`, from its signature to its `$$;`. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION local_service.${name}(`);
  assert.notEqual(start, -1, `the migration must still define local_service.${name}()`);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, `local_service.${name}() must still be a self-contained SQL function`);
  return source.slice(start, end);
}

interface StructuredRaise {
  errcode: string;
  message: string;
  /** The raw statement, so a raise can be located in the source. */
  statement: string;
}

/**
 * `RAISE EXCEPTION USING ERRCODE = '...', MESSAGE  = '...';` — the structured form this
 * contract is about. A bare `RAISE EXCEPTION '<text>'` carries the default `P0001` and
 * no message attribute; that is exactly the trap the app's comment describes, so the
 * contract test reads the structured form only and counts upload-intent raises there.
 */
function structuredRaises(source: string): StructuredRaise[] {
  const pattern = /RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'([^']*)'\s*,\s*MESSAGE\s*=\s*'([^']*)'\s*;/g;
  const raises: StructuredRaise[] = [];
  for (const match of source.matchAll(pattern)) {
    raises.push({ errcode: match[1], message: match[2], statement: match[0] });
  }
  return raises;
}

const RPC_BODY = functionBody(SQL, RPC);
const UPLOAD_INTENT_RAISES = structuredRaises(RPC_BODY)
  .filter((raise) => raise.message.includes(UPLOAD_INTENT_MARKER));

const SQL_MESSAGE = UPLOAD_INTENT_RAISES[0]?.message ?? '';
const SQL_ERRCODE = UPLOAD_INTENT_RAISES[0]?.errcode ?? '';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

function request(payload: unknown) {
  return new Request('https://bk01.test/api/deposit-slips/upload-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(payload),
  });
}

/** A runtime that answers the RPC with one chosen PostgREST-shaped error object. */
function runtime(error: { code?: string; message?: string } | null) {
  return {
    rpc: async () => (error ? { data: null, error } : { data: [{ object_path: `${BOOKING_ID}/1.png` }], error: null }),
    storage: {
      from: () => ({ createSignedUploadUrl: async (p: string) => ({ data: { token: `signed:${p}` }, error: null }) }),
    },
  };
}

test('the migration raises one upload-intent message, and it is the constant the app compares', () => {
  assert.ok(
    UPLOAD_INTENT_RAISES.length > 0,
    `${SQL_FILE_NAME} no longer raises any structured '${UPLOAD_INTENT_MARKER}…' message in ${RPC}(); `
      + 'the app has nothing to match and the ceiling would surface as a bad token',
  );
  assert.equal(
    UPLOAD_INTENT_RAISES.length,
    1,
    `expected exactly one upload-intent raise in ${RPC}(); the discriminator must stay unambiguous: `
      + UPLOAD_INTENT_RAISES.map((raise) => raise.message).join(' | '),
  );
  assert.equal(
    SQL_MESSAGE,
    app.UPLOAD_INTENT_DAILY_LIMIT_SQL_MESSAGE,
    'the string the SQL raises and the string the app compares are the same contract; '
      + 'changing either one alone is the silent drift this file exists to catch',
  );
  assert.equal(
    SQL_ERRCODE,
    EXPECTED_ERRCODE,
    `the app reads the message out of a grant-less PostgREST error; ${SQL_FILE_NAME} must keep the code it was written against`,
  );
  assert.equal(
    app.UPLOAD_INTENT_DAILY_LIMIT_SQL_MESSAGE,
    'UPLOAD_INTENT_LIMIT',
    'the app constant itself is part of the contract — the migration above is compared against THIS value',
  );
});

test('the message taken from the migration is the one the handler turns into the daily refusal', async () => {
  // The end-to-end direction: SQL text → app. Nothing here is hand-typed, so a one-sided
  // edit on either side lands as a 403 and fails the case.
  (app.resetUploadIntentRateLimit as () => void)();
  const response = await app.handleUploadIntent(request({
    bookingId: BOOKING_ID,
    recoveryToken: 'RECOVERY-TOKEN',
    contentType: 'image/png',
    size: 2048,
  }), async () => runtime({ code: SQL_ERRCODE, message: SQL_MESSAGE }) as never);

  assert.equal(
    response.status,
    429,
    `the exact message ${SQL_FILE_NAME} raises (${JSON.stringify(SQL_MESSAGE)}) must read as the quota refusal, not a wrong token`,
  );
  const payload = await response.json() as { code?: string; scope?: string; error?: string };
  assert.equal(payload.scope, 'booking_daily');
  assert.equal(payload.code, 'UPLOAD_INTENT_DAILY_LIMIT');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('the migration raises the ceiling in the RPC the app actually calls', () => {
  const raise = UPLOAD_INTENT_RAISES[0];
  assert.ok(raise, `no upload-intent raise found in ${RPC}()`);
  assert.ok(
    RPC_BODY.includes(raise.statement),
    `the '${UPLOAD_INTENT_MARKER}' raise must sit inside local_service.${RPC}() — the app only ever reads that call's error`,
  );
  const otherRpc = functionBody(SQL, 'bk01_line_bind_booking');
  assert.ok(
    !otherRpc.includes(raise.statement),
    'the ceiling must not be raised by another RPC the app does not map',
  );
  assert.ok(
    SQL_PATH.endsWith(SQL_FILE_NAME),
    `the contract is pinned to ${SQL_FILE_NAME}, but ${SQL_PATH} was read`,
  );
});
