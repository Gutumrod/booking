import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateBk01MigrationSql } from '../scripts/lib/bk01-migration-policy.mjs';

const read = (path: string) => readFileSync(path, 'utf8');

test('BK01 migration policy accepts explicitly qualified product-local changes', () => {
  assert.equal(validateBk01MigrationSql(`
    create table local_service_internal.example_state(id uuid primary key);
    alter table local_service.bookings add column if not exists example_note text;
    update local_service.bookings set example_note = null where false;
    grant select on table local_service.bookings to authenticated;
  `, 'accepted.sql'), true);
});

test('BK01 migration policy rejects unqualified and foreign mutation targets', () => {
  assert.throws(() => validateBk01MigrationSql('create table unsafe(id int);', 'unsafe.sql'), /explicitly qualified/);
  assert.throws(() => validateBk01MigrationSql('alter table ps01.bookings add column bad int;', 'ps01.sql'), /BK01 schema/);
  assert.throws(() => validateBk01MigrationSql("insert into storage.buckets(id,name) values('x','x');", 'storage.sql'), /BK01 schema/);
  assert.throws(() => validateBk01MigrationSql('update public.example set x=1;', 'public.sql'), /BK01 schema/);
});

test('BK01 migration policy rejects project-global and dynamic privilege escalation', () => {
  assert.throws(() => validateBk01MigrationSql('create role attacker;', 'role.sql'), /forbidden/);
  assert.throws(() => validateBk01MigrationSql('create extension hstore;', 'extension.sql'), /forbidden/);
  assert.throws(() => validateBk01MigrationSql('alter table local_service.bookings owner to postgres;', 'owner.sql'), /forbidden/);
  assert.throws(() => validateBk01MigrationSql("do $x$ begin execute 'drop table ps01.bookings'; end $x$;", 'dynamic.sql'), /forbidden/);
});

test('BK01 migration policy limits grants to approved global application roles', () => {
  assert.equal(
    validateBk01MigrationSql('grant select on table local_service.bookings to authenticated;', 'grant-ok.sql'),
    true,
  );
  assert.throws(
    () => validateBk01MigrationSql('grant select on table local_service.bookings to ps01_runtime;', 'grant-bad.sql'),
    /non-BK01 allowlisted role/,
  );
});

test('generated bootstrap contains bounded roles and no embedded credential', () => {
  const bootstrap = read('supabase/shared-runtime/bk01-platform-bootstrap.sql');
  const manifest = JSON.parse(read('supabase/shared-runtime/bk01-legacy-baseline.json'));
  assert.match(bootstrap, /CREATE ROLE bk01_migrator NOLOGIN/);
  assert.match(bootstrap, /CREATE ROLE bk01_migrator_login LOGIN/);
  assert.match(bootstrap, /local_service_internal\.schema_migrations/);
  assert.doesNotMatch(bootstrap, /\bPASSWORD\b/i);
  assert.equal(manifest.frozenMigrationCount, 30);
  assert.match(manifest.sourceSha256, /^[0-9a-f]{64}$/);
});

test('product Supabase config is explicitly local-only', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /LOCAL DEVELOPMENT ONLY/);
  assert.match(config, /DO NOT run `supabase config push`/);
});

// ---------------------------------------------------------------------------
// F-6 — the policy must let a REVOKE name PUBLIC (revoking is not granting)
// while still rejecting a GRANT to PUBLIC, and must newly reject a created
// function that carries no REVOKE ALL ON FUNCTION ... FROM PUBLIC.
// ---------------------------------------------------------------------------

const PROBE = 'local_service.bk01_policy_probe(uuid)';

const probeSql = (lines: string[]) => lines.join('\n');

test('F-6 policy accepts PUBLIC as a grantee inside a REVOKE statement', () => {
  assert.equal(
    validateBk01MigrationSql(
      probeSql([
        'create or replace function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
        `revoke all on function ${PROBE} from public;`,
        `revoke all on function ${PROBE} from public, anon, authenticated;`,
        `grant execute on function ${PROBE} to service_role;`,
      ]),
      'revoke-from-public.sql',
    ),
    true,
  );
});

test('F-6 policy still rejects a GRANT to PUBLIC', () => {
  assert.throws(
    () =>
      validateBk01MigrationSql(
        probeSql([
          'create or replace function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
          `revoke all on function ${PROBE} from public, anon;`,
          `grant execute on function ${PROBE} to public;`,
        ]),
        'grant-to-public.sql',
      ),
    /GRANT to PUBLIC/,
  );
  // A GRANT to PUBLIC is rejected even when every role is otherwise allowlisted.
  assert.throws(
    () =>
      validateBk01MigrationSql(
        `grant execute on function ${PROBE} to public, authenticated;`,
        'grant-to-public-mixed.sql',
      ),
    /GRANT to PUBLIC/,
  );
});

test('F-6 policy rejects a created function with no REVOKE from PUBLIC', () => {
  assert.throws(
    () =>
      validateBk01MigrationSql(
        probeSql([
          'create or replace function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
          `revoke all on function ${PROBE} from anon, authenticated;`,
          `grant execute on function ${PROBE} to service_role;`,
        ]),
        'missing-revoke.sql',
      ),
    /REVOKE ALL ON FUNCTION/,
  );
  // A bare CREATE FUNCTION (no OR REPLACE) gets PUBLIC's default EXECUTE too.
  assert.throws(
    () =>
      validateBk01MigrationSql(
        probeSql([
          'create function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
          `grant execute on function ${PROBE} to service_role;`,
        ]),
        'missing-revoke-create.sql',
      ),
    /REVOKE ALL ON FUNCTION/,
  );
});

test('F-6 policy rejects a SECURITY INVOKER function that lacks its REVOKE', () => {
  assert.throws(
    () =>
      validateBk01MigrationSql(
        probeSql([
          'create or replace function local_service.bk01_policy_probe() returns trigger language plpgsql security invoker as $$ begin return new; end $$;',
          'revoke all on function local_service.bk01_policy_probe() from anon, authenticated;',
          'grant execute on function local_service.bk01_policy_probe() to authenticated;',
        ]),
        'invoker-missing-revoke.sql',
      ),
    /REVOKE ALL ON FUNCTION/,
  );
});

test('F-6 policy rejects a replaced signature that lacks its own REVOKE', () => {
  assert.throws(
    () =>
      validateBk01MigrationSql(
        probeSql([
          'create or replace function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
          `revoke all on function ${PROBE} from public, anon, authenticated;`,
          `grant execute on function ${PROBE} to service_role;`,
          'create or replace function local_service.bk01_policy_probe(p uuid, q text) returns int language sql as $$ select 1 $$;',
          `grant execute on function local_service.bk01_policy_probe(uuid, text) to service_role;`,
        ]),
        'replaced-signature.sql',
      ),
    /REVOKE ALL ON FUNCTION/,
  );
  // The same file with the second REVOKE present is accepted.
  assert.equal(
    validateBk01MigrationSql(
      probeSql([
        'create or replace function local_service.bk01_policy_probe(p uuid) returns int language sql as $$ select 1 $$;',
        `revoke all on function ${PROBE} from public, anon, authenticated;`,
        `grant execute on function ${PROBE} to service_role;`,
        'create or replace function local_service.bk01_policy_probe(p uuid, q text) returns int language sql as $$ select 1 $$;',
        'revoke all on function local_service.bk01_policy_probe(uuid, text) from public, anon, authenticated;',
        'grant execute on function local_service.bk01_policy_probe(uuid, text) to service_role;',
      ]),
      'replaced-signature-fixed.sql',
    ),
    true,
  );
});
