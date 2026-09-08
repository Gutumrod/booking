import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fail = (message) => { throw new Error(message); };

const legacyDir = path.join(root, 'supabase', 'migrations');
const legacyFiles = fs.readdirSync(legacyDir).filter((name) => name.endsWith('.sql')).sort();
if (legacyFiles.length !== 30) fail(`Expected frozen legacy migration count 30, found ${legacyFiles.length}.`);

const legacyHash = crypto.createHash('sha256')
  .update(legacyFiles.map((name) => {
    const text = fs.readFileSync(path.join(legacyDir, name), 'utf8').replace(/\r\n/g, '\n');
    return `${name}\n${text}`;
  }).join('\n'))
  .digest('hex');

const manifest = JSON.parse(read('supabase/shared-runtime/bk01-legacy-baseline.json'));
if (manifest.sourceSha256 !== legacyHash || manifest.frozenMigrationCount !== 30) {
  fail('Generated BK01 legacy baseline manifest does not match frozen migration sources.');
}

const bootstrap = read('supabase/shared-runtime/bk01-platform-bootstrap.sql');
for (const needle of [
  'CREATE ROLE bk01_migrator NOLOGIN',
  'CREATE ROLE bk01_migrator_login LOGIN',
  'CREATE SCHEMA IF NOT EXISTS local_service_internal AUTHORIZATION bk01_migrator',
  'ALTER SCHEMA local_service OWNER TO bk01_migrator',
  'local_service_internal.migration_baseline',
  'local_service_internal.schema_migrations',
  "pg_advisory_xact_lock",
].slice(0, -1)) {
  if (!bootstrap.includes(needle)) fail(`Bootstrap missing required boundary: ${needle}`);
}
if (/\bPASSWORD\b/i.test(bootstrap)) fail('Generated bootstrap must never contain a database password.');
if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|FUNCTION|TYPE)\s+ps01\./i.test(bootstrap)) {
  fail('Generated bootstrap attempts PS01 object mutation.');
}
if (!bootstrap.includes("local_service.link_staff_user(uuid,text)")) {
  fail('Shared-surface function ownership exception inventory is missing.');
}
if (!bootstrap.includes("local_service.submit_deposit_slip(uuid,text,text,text)")) {
  fail('Storage-linked function ownership exception inventory is missing.');
}

const runner = read('scripts/bk01-migrate.mjs');
for (const needle of [
  'BK01_MIGRATOR_DATABASE_URL',
  'BK01_EXPECTED_PROJECT_REF',
  'SET LOCAL ROLE bk01_migrator',
  'pg_advisory_xact_lock',
  'local_service_internal.schema_migrations',
]) {
  if (!runner.includes(needle)) fail(`Runner missing required control: ${needle}`);
}

if (/supabase\s+(?:db\s+push|migration\s+repair|config\s+push)/i.test(runner)) {
  fail('BK01 product runner contains a forbidden shared-project Supabase CLI mutation path.');
}

const packageJson = JSON.parse(read('package.json'));
if (packageJson.devDependencies?.postgres !== '3.4.9') {
  fail('postgres migration-runner dependency must be exact version 3.4.9.');
}
for (const scriptName of ['db:bk01:generate', 'db:bk01:verify', 'db:bk01:plan', 'db:bk01:apply']) {
  if (!packageJson.scripts?.[scriptName]) fail(`Missing package script: ${scriptName}`);
}

const config = read('supabase/config.toml');
if (!config.includes('LOCAL DEVELOPMENT ONLY')) {
  fail('supabase/config.toml must explicitly state that it is local-only for shared runtime.');
}
if (!config.includes('DO NOT run `supabase config push`')) {
  fail('supabase/config.toml is missing the shared-project config-push prohibition.');
}

const migrationDiff = execFileSync('git', ['diff', '--name-only', '--', 'supabase/migrations'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (migrationDiff) fail(`Frozen legacy migrations were modified:\n${migrationDiff}`);

console.log('BK01 shared-runtime repository verification PASS');
console.log(`Frozen legacy migrations: ${legacyFiles.length}`);
console.log(`Legacy source SHA-256: ${legacyHash}`);
console.log('Active migration stream: supabase/bk01-migrations');
console.log('Platform/global Supabase CLI mutation path: disabled by contract');
