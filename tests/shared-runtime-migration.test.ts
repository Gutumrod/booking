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
