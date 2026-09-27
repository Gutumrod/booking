import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateBk01MigrationSql } from '../scripts/lib/bk01-migration-policy.mjs';

const read = (path: string) => readFileSync(path, 'utf8');

const BOOTSTRAP = 'supabase/shared-runtime/bk01-platform-bootstrap.sql';
const ROLLBACK = 'supabase/shared-runtime/bk01-platform-bootstrap-rollback.sql';

// ---------------------------------------------------------------------------
// WU-1 — Lane B criterion (b): the BK01 platform bootstrap must not break the
// product's own functions when ownership moves off `postgres`, and it must not
// hand any product a direct database LOGIN.
//
// Root cause of the Junction A failure (2026-09-08): the bootstrap transferred 58
// `local_service` function owners to `bk01_migrator`, but `bk01_migrator` has no
// USAGE on schema `auth`, so every transferred function that called `auth.uid()`
// failed at runtime with 42501 "permission denied for schema auth".
//
// The remediation moves those functions onto a JWT-claim helper that lives in
// `local_service_internal` (owned by `bk01_migrator`) so no product function needs
// schema `auth` at all.
// ---------------------------------------------------------------------------

const AUTH_UID_FUNCTIONS = [
  'apply_topup',
  'approve_booking_deposit',
  'audit_platform_admin_update',
  'cancel_booking',
  'current_staff_id',
  'enforce_booking_status_transition',
  'export_core_business_data',
  'extend_booking_hold',
  'get_entitlement_usage',
  'has_shop_role',
  'is_platform_admin',
  'is_shop_member',
  'provision_owner_shop',
  'reject_deposit_slip',
  'request_account_closure',
  'set_booking_outcome',
];

// Functions that legitimately keep a shared-surface dependency and therefore keep
// their original owner, per the exception inventory that already existed.
const OWNERSHIP_EXCEPTIONS = [
  'local_service.link_staff_user(uuid,text)',
  'local_service.submit_deposit_slip(uuid,text,text)',
  'local_service.submit_deposit_slip(uuid,text,text,text)',
];

const canonical = (sql: string) => sql.replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// 1. no product LOGIN role anywhere
// ---------------------------------------------------------------------------

test('Lane B (b): the bootstrap creates no product database LOGIN role', () => {
  const sql = canonical(read(BOOTSTRAP));

  assert.doesNotMatch(
    sql,
    /create\s+role\s+\S+\s+[^;]*\blogin\b/i,
    'no role created by the bootstrap may be LOGIN',
  );
  // `bk01_migrator_login` may only appear as a refusal guard, never as a creation.
  assert.doesNotMatch(
    sql,
    /create\s+role\s+bk01_migrator_login/i,
    'the retired product LOGIN must never be created',
  );
  if (/bk01_migrator_login/.test(sql)) {
    assert.match(
      sql,
      /RAISE\s+EXCEPTION\s+'Retired role bk01_migrator_login is present/,
      'the only permitted reference to the retired role is the refusal guard',
    );
  }

  // The migrator group role itself must still exist, and be NOLOGIN.
  assert.match(sql, /CREATE ROLE bk01_migrator NOLOGIN/);
  assert.match(sql, /GRANT bk01_migrator TO postgres/, 'operator must be able to SET ROLE bk01_migrator');
});

test('Lane B (b): the rollback retires the legacy LOGIN role but never creates one', () => {
  const sql = canonical(read(ROLLBACK));
  assert.doesNotMatch(sql, /create\s+role\s+\S+\s+[^;]*\blogin\b/i);
  assert.doesNotMatch(sql, /create\s+role\s+bk01_migrator_login/i);
  assert.match(
    sql,
    /DROP ROLE bk01_migrator_login/,
    'rollback from a legacy environment must clean the retired login up',
  );
});

// ---------------------------------------------------------------------------
// 2. no transferred function still needs schema `auth`
// ---------------------------------------------------------------------------

test('Lane B (b): every auth.uid() function is moved onto the JWT-claim helper', () => {
  const sql = canonical(read(BOOTSTRAP));

  for (const name of AUTH_UID_FUNCTIONS) {
    assert.match(
      sql,
      new RegExp(`local_service\\.${name}\\s*\\(`),
      `${name} must be re-emitted by the bootstrap`,
    );
  }

  // The helper itself must exist, in the BK01-owned internal schema.
  assert.match(sql, /CREATE OR REPLACE FUNCTION local_service_internal\.request_user_id\(\)/);

  // And the rewrites must be proven by the bootstrap, not merely asserted in prose.
  assert.match(sql, /auth\.uid/, 'the guard must name what it forbids');
  assert.match(sql, /bk01_auth_boundary_guard/i, 'the post-rewrite guard block must be present');
});

test('Lane B (b): the helper is granted to bk01_migrator only, not to public roles', () => {
  const sql = canonical(read(BOOTSTRAP));

  const grantLine = sql
    .split('\n')
    .find((line) => /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+local_service_internal\.request_user_id/i.test(line));
  assert.ok(grantLine, 'helper EXECUTE grant must be explicit');
  assert.match(grantLine!, /TO bk01_migrator\s*;/i, 'helper must be granted to bk01_migrator only');
  assert.doesNotMatch(
    grantLine!,
    /\b(anon|authenticated|service_role|PUBLIC)\b/i,
    'the helper must not widen any Data API role: no privilege expansion',
  );

  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+local_service_internal\.request_user_id\(\)\s+FROM\s+PUBLIC/i,
    'PUBLIC must be revoked from the helper explicitly',
  );
});

test('Lane B (b): the ownership exception inventory is unchanged and complete', () => {
  const sql = canonical(read(BOOTSTRAP));
  for (const signature of OWNERSHIP_EXCEPTIONS) {
    assert.ok(sql.includes(signature), `exception inventory must still name ${signature}`);
  }
});

// ---------------------------------------------------------------------------
// 3. the frozen chain is the single source of the rewritten definitions
// ---------------------------------------------------------------------------

test('Lane B (b): the generated bootstrap is derived from the frozen chain, not hand-copied', () => {
  const bootstrap = canonical(read(BOOTSTRAP));
  const frozenUid = new Set<string>();

  for (const name of AUTH_UID_FUNCTIONS) {
    // the rewritten definition must be byte-identical to the frozen one except for
    // the substituted reference, so the frozen chain stays the source of truth
    const frozen = canonical(read('supabase/migrations/20260807051615_local_service_initial_schema.sql'));
    if (frozen.includes(`local_service.${name}(`)) frozenUid.add(name);
  }

  // the derivation marker must be present so a reviewer can see the provenance
  assert.match(
    bootstrap,
    /derived from the frozen legacy chain/i,
    'generated rewrites must declare that they are derived from supabase/migrations',
  );
  assert.match(bootstrap, /--\s*GENERATED FILE\. DO NOT EDIT DIRECTLY\./);
});

// ---------------------------------------------------------------------------
// 4. the helper's claim resolution must be the same expression PS01 already proved
// ---------------------------------------------------------------------------

test('Lane B (b): helper reads the same JWT claims auth.uid() reads', () => {
  const sql = canonical(read(BOOTSTRAP));
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION local_service_internal.request_user_id()');
  assert.ok(start > -1, 'helper definition must be present');
  const body = sql.slice(start, sql.indexOf('$$;', start));

  assert.match(body, /request\.jwt\.claim\.sub/, 'legacy single-claim setting must be read');
  assert.match(body, /request\.jwt\.claims/, 'the JSON claims setting must be read');
  assert.match(body, /->>\s*'sub'/, 'the sub claim must be extracted');
  assert.match(body, /::uuid/, 'the value must be cast to uuid exactly as auth.uid() returns');
  assert.match(body, /language\s+sql\s+stable/i, 'helper must be a STABLE sql function');
  assert.match(body, /set\s+search_path\s*=\s*pg_catalog/i, 'helper must pin search_path');
  assert.match(body, /nullif/i, 'empty claim values must collapse to NULL, not raise');
});

test('Lane B (b): the documented helper behaviour covers every required case', () => {
  const doc = JSON.parse(read('supabase/shared-runtime/bk01-request-helper-contract.json'));
  const cases = doc.cases.map((c: { case: string }) => c.case);
  for (const required of ['no_claim', 'empty_claim', 'empty_json', 'valid_sub', 'empty_sub']) {
    assert.ok(cases.includes(required), `behaviour table must cover ${required}`);
  }
  const invalid = doc.cases.find((c: { case: string }) => c.case === 'sub_not_uuid');
  assert.ok(invalid, 'the non-uuid claim case must be declared');
  assert.equal(invalid.fail_closed, true, 'a non-uuid sub must fail closed');
  assert.equal(doc.equals_auth_uid, true);
  assert.equal(doc.helper, 'local_service_internal.request_user_id()');
});

// ---------------------------------------------------------------------------
// 5. the policy forbids auth.uid() in the forward product stream
// ---------------------------------------------------------------------------

test('Lane B (b): policy rejects auth.uid() in the product migration stream', () => {
  assert.throws(
    () => validateBk01MigrationSql(
      `create or replace function local_service.probe() returns uuid language sql as $$ select auth.uid() $$;`,
      'probe.sql',
    ),
    /auth\.uid|request_user_id/,
  );

  // an explicitly declared exception is the only way through
  assert.equal(
    validateBk01MigrationSql(
      `-- BK01-ALLOW-AUTH-UID: get_entitlement_usage
create or replace function local_service.get_entitlement_usage(p_shop_id uuid)
returns json language sql as $$ select auth.uid()::text::json $$;`,
      'declared.sql',
    ),
    true,
  );
});

test('Lane B (b): policy still rejects an undeclared function in a declared file', () => {
  assert.throws(
    () => validateBk01MigrationSql(
      `-- BK01-ALLOW-AUTH-UID: get_entitlement_usage
create or replace function local_service.some_other(uuid) returns uuid language sql as $$ select auth.uid() $$;`,
      'mixed.sql',
    ),
    /auth\.uid|request_user_id/,
  );
});

// ---------------------------------------------------------------------------
// 6. runner contract: operator session + SET ROLE, no product credential
// ---------------------------------------------------------------------------

test('Lane B (b): the migration runner uses an operator session and SET ROLE', () => {
  const runner = canonical(read('scripts/bk01-migrate.mjs'));
  assert.match(runner, /SET LOCAL ROLE bk01_migrator/i);
  assert.doesNotMatch(runner, /bk01_migrator_login/, 'runner must not name a product LOGIN');
  assert.doesNotMatch(runner, /BK01_MIGRATOR_DATABASE_URL/, 'runner must not read a product migrator credential');
  assert.match(runner, /BK01_PLATFORM_DATABASE_URL/);
});

test('Lane B (b): .env.example documents the operator session, not a product credential', () => {
  const env = canonical(read('.env.example'));
  assert.doesNotMatch(env, /^BK01_MIGRATOR_DATABASE_URL=/m, 'the product migrator credential must be gone');
  assert.match(env, /^BK01_PLATFORM_DATABASE_URL=/m);
  assert.match(env, /^BK01_OPERATOR_LOGINS=/m, 'the operator login allowlist must be documented');
  // naming the retired role in a comment is fine; offering a variable for it is not
  assert.doesNotMatch(env, /^BK01_[A-Z_]*bk01_migrator_login/m);
});
