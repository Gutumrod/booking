import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

/*
 * F1 recurrence guard (HOUSE-BK01-P0-APP, independent audits 2026-10-02).
 *
 * The P0 SQL migration narrows the public booking profile to an explicit column
 * set. The consumer must select ONLY columns that set actually contains — a single
 * missing column turns every `/book/[slug]` load into LOAD_ERROR, for every slug,
 * before any row is even considered.
 *
 * This test reads the AUTHORITATIVE column list out of the migration source rather
 * than restating it: any future SQL/app column drift fails here, not only this one
 * field. The SQL worktree is read-only from the app side.
 *
 * SQL SOURCE RESOLUTION — ordered, documented, FAIL CLOSED (see
 * resolvePublicProfileSql()). The function definition must never be assumed to live
 * in any single tree, and its absence must never be mistaken for a pass or a skip.
 * The lookup tries, in order:
 *   1. $BK01_PUBLIC_PROFILE_SQL         — explicit override (absolute or repo-relative).
 *   2. supabase/bk01-migrations/*.sql  — this repository's own migration stream,
 *                                        newest file first, and only the first file
 *                                        that ACTUALLY defines the function.
 *   3. the sibling SQL worktree path   — resolved relative to THIS test file
 *                                        (read-only; the path used historically).
 * If no candidate defines the function, the test throws an Error naming every path
 * that was tried and the reason each one failed (missing file vs. function absent).
 */

const FUNCTION_SIGNATURE = 'CREATE FUNCTION local_service.bk01_public_shop_profiles()';
const ENV_SQL_OVERRIDE = 'BK01_PUBLIC_PROFILE_SQL';
const REPO_LOCAL_MIGRATION_DIR = 'supabase/bk01-migrations';
const SIBLING_SQL_MIGRATION_REL =
  '../../bk01-p0-sql-20261002/supabase/bk01-migrations/20261002120000_bk01_council_p0.sql';

const TEST_DIR = import.meta.dirname;
const REPO_ROOT = resolve(TEST_DIR, '..');

const SERVICE = 'apps/booking-consumer/src/lib/booking-service.ts';
const PAGE = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';

const read = (filePath: string) => readFileSync(filePath, 'utf8');

/** Newest-first by filename: migration names are timestamp-prefixed, so lexicographic desc == newest first. */
function sqlFilesNewestFirst(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * Resolve the SQL migration source that defines `local_service.bk01_public_shop_profiles()`.
 *
 * Returns `{ path, sql }` for the first candidate that actually contains the function
 * definition. When no candidate does, throws an Error naming every path that was tried
 * and why each one failed — absence is never treated as success and the caller is never
 * allowed to skip silently.
 */
function resolvePublicProfileSql(): { path: string; sql: string } {
  const attempts: string[] = [];
  const tryFile = (source: string, filePath: string): { path: string; sql: string } | null => {
    let sql: string;
    try {
      sql = read(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      attempts.push(`${source}: ${filePath} — unreadable (${code})`);
      return null;
    }
    if (!sql.includes(FUNCTION_SIGNATURE)) {
      attempts.push(`${source}: ${filePath} — file present but does not define the function`);
      return null;
    }
    console.log(`[F1] public-profile SQL resolved via ${source}: ${filePath}`);
    return { path: filePath, sql };
  };

  // 1. Explicit override. When set it is authoritative: no fallback, so a typo or a
  //    stale path fails loudly instead of silently falling through to another tree.
  const override = process.env[ENV_SQL_OVERRIDE]?.trim();
  if (override) {
    const resolved = resolve(REPO_ROOT, override);
    const hit = tryFile(`${ENV_SQL_OVERRIDE} override`, resolved);
    if (hit) return hit;
    throw new Error(
      `F1 recurrence guard: ${ENV_SQL_OVERRIDE} is set but did not yield ` +
        `"${FUNCTION_SIGNATURE}".\nTried:\n  - ${attempts.join('\n  - ')}\n` +
        `Unset ${ENV_SQL_OVERRIDE} (or point it at a migration that defines the function) to use the default lookup.`,
    );
  }

  // 2. This repository's own migration stream: newest *.sql first, but only the first
  //    file that ACTUALLY defines the function — newest alone is not good enough.
  const repoLocalDir = join(REPO_ROOT, REPO_LOCAL_MIGRATION_DIR);
  let repoLocalFiles: string[];
  try {
    repoLocalFiles = sqlFilesNewestFirst(repoLocalDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    attempts.push(`repo-local ${REPO_LOCAL_MIGRATION_DIR}: ${repoLocalDir} — unreadable (${code})`);
    repoLocalFiles = [];
  }
  if (repoLocalFiles.length === 0) {
    attempts.push(`repo-local ${REPO_LOCAL_MIGRATION_DIR}: ${repoLocalDir} — no *.sql migration found`);
  }
  for (const name of repoLocalFiles) {
    const hit = tryFile(`repo-local ${REPO_LOCAL_MIGRATION_DIR}`, join(repoLocalDir, name));
    if (hit) return hit;
  }

  // 3. The sibling SQL worktree path used historically. Resolved relative to THIS test
  //    file (not the process cwd) and read-only.
  const siblingPath = resolve(TEST_DIR, SIBLING_SQL_MIGRATION_REL);
  const hit = tryFile('sibling SQL worktree', siblingPath);
  if (hit) return hit;

  throw new Error(
    `F1 recurrence guard: no SQL source defines "${FUNCTION_SIGNATURE}".\nTried:\n  - ` +
      `${attempts.join('\n  - ')}\n` +
      `Set ${ENV_SQL_OVERRIDE} to the migration that defines the function, or add it to ` +
      `${REPO_LOCAL_MIGRATION_DIR}/ in this repository.`,
  );
}

/** The column names of `local_service.bk01_public_shop_profiles()`'s RETURNS TABLE. */
function sqlPublicProfileColumns(): string[] {
  const { path: sqlPath, sql } = resolvePublicProfileSql();
  const fnStart = sql.indexOf(FUNCTION_SIGNATURE);
  assert.ok(fnStart >= 0, `the public-profile function must exist in ${sqlPath}`);
  const body = sql.slice(fnStart);
  const match = body.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)/i);
  assert.ok(match, 'the public-profile function must declare an explicit RETURNS TABLE');
  return match[1]
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0].trim().toLowerCase())
    .filter(Boolean);
}

/** The columns `getShopBySlug()` selects from `shop_public_profile`. */
function appSelectColumns(): string[] {
  const service = read(SERVICE);
  const fromIdx = service.indexOf(".from('shop_public_profile')");
  assert.ok(fromIdx >= 0, 'the consumer must read shop_public_profile through getShopBySlug');
  const match = service.slice(fromIdx).match(/\.select\(\s*(['"])([\s\S]*?)\1/);
  assert.ok(match, 'the shop_public_profile read must use an explicit .select(...) allow-list');
  return match[2]
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

test('F1 the consumer select of shop_public_profile is a subset of the P0 view columns', () => {
  const sqlColumns = sqlPublicProfileColumns();
  const appColumns = appSelectColumns();

  assert.ok(sqlColumns.length > 0, 'the P0 view column list must be non-empty');
  assert.ok(appColumns.length > 0, 'the consumer select allow-list must be non-empty');

  const missing = appColumns.filter((column) => !sqlColumns.includes(column));
  assert.deepEqual(
    missing,
    [],
    `consumer selects column(s) absent from the effective public profile view: ${missing.join(', ')}`,
  );
});

test('F1 line_oa_id is absent from both the P0 view and the consumer select', () => {
  assert.ok(
    !sqlPublicProfileColumns().includes('line_oa_id'),
    'the P0 view intentionally drops line_oa_id from the public profile',
  );
  assert.ok(
    !appSelectColumns().includes('line_oa_id'),
    'selecting line_oa_id from shop_public_profile errors every booking page load',
  );
});

test('F1 the Shop interface models no line_oa_id and the book page binds to the central OA', () => {
  const service = read(SERVICE);
  const page = read(PAGE);

  assert.doesNotMatch(service, /line_oa_id\s*:/, 'the consumer interface must not model the dropped column');
  assert.doesNotMatch(
    page,
    /shop\?\.line_oa_id/,
    'the page must use the central OA, never a per-shop LINE OA value',
  );
  assert.match(
    page,
    /import\s*\{\s*CENTRAL_LINE_OA_ID\s*\}\s*from\s*'[^']*lib\/line-link'/,
    'the binding target must come from the single source in lib/line-link.ts',
  );
  assert.match(
    page,
    /oaMessage\/@\$\{CENTRAL_LINE_OA_ID\}/,
    'the binding URL must be built from CENTRAL_LINE_OA_ID',
  );
});
