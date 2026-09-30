import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBk01MigrationSql, BK01_OWNED_SCHEMAS, BK01_ALLOWED_GRANTEES } from './lib/bk01-migration-policy.mjs';
import { BK01_RUNTIME_EFFECTIVE_FUNCTIONS, validateBk01RuntimeAuthority, validateBk01RuntimeEffectiveExecuteSet } from './lib/bk01-runtime-allowlist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'bk01-migrations');
const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const name of migrations) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`${name}: invalid migration filename`);
  const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
  if (!sql.trim()) throw new Error(`${name}: empty migration`);
  validateBk01MigrationSql(sql, name);
  if (/\bextensions\s*\./i.test(sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' '))) {
    throw new Error(`${name}: product migration references extensions schema`);
  }
}

console.log(`Migrations accepted: ${migrations.length}; owned schemas: ${BK01_OWNED_SCHEMAS.join(', ')}; grant roles: ${BK01_ALLOWED_GRANTEES.join(', ')}`);

// Non-vacuity: every policy family is exercised with an input that must fail.
const policyViolations = [
  ['F-6 CREATE INVOKER without PUBLIC revoke', 'CREATE FUNCTION local_service.p() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;'],
  ['F-6 changed signature without matching revoke', 'CREATE FUNCTION local_service.p(a int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; REVOKE ALL ON FUNCTION local_service.p(int) FROM PUBLIC; CREATE OR REPLACE FUNCTION local_service.p(a int,b int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;'],
  ['auth.uid undeclared', 'CREATE FUNCTION local_service.p() RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid() $$; REVOKE ALL ON FUNCTION local_service.p() FROM PUBLIC;'],
  ['auth.uid declaration for a different function', '-- BK01-ALLOW-AUTH-UID: other\nCREATE FUNCTION local_service.p() RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid() $$; REVOKE ALL ON FUNCTION local_service.p() FROM PUBLIC;'],
  ['auth.users reference', 'SELECT * FROM auth.users;'],
  ...[
    ['TABLE', 'CREATE TABLE bookings (id int);'], ['VIEW', 'CREATE VIEW bookings AS SELECT 1;'],
    ['MATERIALIZED VIEW', 'CREATE MATERIALIZED VIEW bookings AS SELECT 1;'],
    ['FUNCTION', 'CREATE FUNCTION probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;'],
    ['TYPE', 'CREATE TYPE booking_state AS ENUM (\'open\');'], ['SEQUENCE', 'CREATE SEQUENCE booking_ids;'],
    ['INSERT', 'INSERT INTO bookings VALUES (1);'], ['UPDATE', 'UPDATE bookings SET id = 2;'],
    ['DELETE', 'DELETE FROM bookings;'], ['TRUNCATE', 'TRUNCATE TABLE bookings;'],
    ['INDEX', 'DROP INDEX booking_idx;'], ['CREATE INDEX ON', 'CREATE INDEX booking_idx ON bookings (id);'],
    ['TRIGGER ON', 'CREATE TRIGGER booking_trigger BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION local_service.p();'],
    ['POLICY ON', 'CREATE POLICY booking_policy ON bookings USING (true);'],
    ['COMMENT ON', 'COMMENT ON TABLE bookings IS \'probe\';'],
  ].map(([label, sql]) => [`unqualified ${label} target`, sql]),
  ['GRANT PUBLIC', 'GRANT EXECUTE ON FUNCTION local_service.p() TO PUBLIC;'],
  ['non-allowlisted grant role', 'GRANT SELECT ON TABLE local_service.bookings TO random_role;'],
  ...[
    ['CREATE ROLE', 'CREATE ROLE x;'], ['ALTER USER', 'ALTER USER x;'], ['DROP DATABASE', 'DROP DATABASE x;'],
    ['CREATE EXTENSION', 'CREATE EXTENSION x;'], ['CREATE SCHEMA', 'CREATE SCHEMA x;'],
    ['ALTER DEFAULT PRIVILEGES', 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;'],
    ['OWNER TO', 'ALTER TABLE local_service.x OWNER TO anon;'], ['SET AUTHORIZATION', 'SET AUTHORIZATION x;'],
    ['SET SESSION SESSION AUTHORIZATION', 'SET SESSION SESSION AUTHORIZATION x;'], ['SET LOCAL SESSION AUTHORIZATION', 'SET LOCAL SESSION AUTHORIZATION x;'],
    ['RESET SESSION AUTHORIZATION', 'RESET SESSION AUTHORIZATION;'],
    ['SET ROLE', 'SET LOCAL ROLE x;'], ['RESET ROLE', 'RESET ROLE;'], ['VACUUM', 'VACUUM;'],
    ['REINDEX DATABASE', 'REINDEX DATABASE x;'], ['CLUSTER', 'CLUSTER local_service.t;'], ['CONCURRENTLY', 'CREATE INDEX CONCURRENTLY x ON local_service.t (id);'],
    ['supabase_migrations', 'SELECT * FROM supabase_migrations.schema_migrations;'], ['DO block', 'DO $$ BEGIN NULL; END $$;'],
    ['transaction control', 'BEGIN;'],
  ].map(([label, sql]) => [`forbidden ${label}`, sql]),
  ['runtime LOGIN', 'ALTER ROLE bk01_runtime LOGIN;'],
  ['runtime unlisted RPC', 'GRANT EXECUTE ON FUNCTION local_service.unlisted_rpc(uuid) TO bk01_runtime;'],
  ['runtime table DML', 'GRANT INSERT ON TABLE local_service.bookings TO bk01_runtime;'],
  ['runtime foreign schema', 'GRANT USAGE ON SCHEMA ps01 TO bk01_runtime;'],
  ['runtime non-SET-only membership', 'GRANT bk01_runtime TO service_role WITH INHERIT FALSE, SET TRUE;'],
];
for (const [label, sql] of policyViolations) {
  let rejected = false;
  try { validateBk01MigrationSql(sql, `crafted:${label}`); } catch { rejected = true; }
  if (!rejected) throw new Error(`Migration policy non-vacuity failed: ${label}`);
}

// Runtime grant direction and exact effective set have direct probes as well.
const violatingInputs = [
  'ALTER ROLE bk01_runtime LOGIN;',
  'GRANT EXECUTE ON FUNCTION local_service.unlisted_rpc(uuid) TO bk01_runtime;',
  'GRANT INSERT ON TABLE local_service.bookings TO bk01_runtime;',
  'GRANT USAGE ON SCHEMA ps01 TO bk01_runtime;',
  'GRANT bk01_runtime TO service_role WITH INHERIT FALSE, SET TRUE;',
];
for (const [index, sql] of violatingInputs.entries()) {
  let rejected = false;
  try { validateBk01RuntimeAuthority(sql, `crafted-${index}`); }
  catch { rejected = true; }
  if (!rejected) throw new Error(`Runtime privilege policy failed non-vacuity probe ${index}`);
}

const effectiveSetProbes = [
  ['9th PUBLIC function', [...BK01_RUNTIME_EFFECTIVE_FUNCTIONS, 'local_service.ninth_public_probe()']],
  ['extra explicit runtime grant', [...BK01_RUNTIME_EFFECTIVE_FUNCTIONS, 'local_service.extra_runtime_probe()']],
  ['12th explicit RPC identity', [...BK01_RUNTIME_EFFECTIVE_FUNCTIONS, 'local_service.twelfth_route_probe()']],
];
for (const [label, observed] of effectiveSetProbes) {
  let rejected = false;
  try { validateBk01RuntimeEffectiveExecuteSet(observed, label); }
  catch { rejected = true; }
  if (!rejected) throw new Error(`Effective EXECUTE non-vacuity failed: ${label}`);
}

console.log('BK01 migration policy PASS');
console.log(`Migration policy violating inputs rejected: ${policyViolations.length}/${policyViolations.length}`);
console.log(`bk01_runtime authority violating inputs rejected: ${violatingInputs.length}/${violatingInputs.length}`);
console.log(`effective EXECUTE violating sets rejected: ${effectiveSetProbes.length}/${effectiveSetProbes.length}`);
