import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 */

const SQL_WORKTREE_MIGRATION =
  '../bk01-p0-sql-20261002/supabase/bk01-migrations/20261002120000_bk01_council_p0.sql';
const SERVICE = 'apps/booking-consumer/src/lib/booking-service.ts';
const PAGE = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';

const read = (path: string) => readFileSync(path, 'utf8');

/** The column names of `local_service.bk01_public_shop_profiles()`'s RETURNS TABLE. */
function sqlPublicProfileColumns(): string[] {
  const sql = read(SQL_WORKTREE_MIGRATION);
  const fnStart = sql.indexOf('CREATE FUNCTION local_service.bk01_public_shop_profiles()');
  assert.ok(fnStart >= 0, `the public-profile function must exist in ${SQL_WORKTREE_MIGRATION}`);
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
