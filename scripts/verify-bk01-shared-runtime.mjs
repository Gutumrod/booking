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
const rollback = read('supabase/shared-runtime/bk01-platform-bootstrap-rollback.sql');
const contract = JSON.parse(read('supabase/shared-runtime/bk01-request-helper-contract.json'));

// ---------------------------------------------------------------------------
// Required structure
// ---------------------------------------------------------------------------
for (const needle of [
  'CREATE ROLE bk01_migrator NOLOGIN',
  'CREATE SCHEMA IF NOT EXISTS local_service_internal AUTHORIZATION bk01_migrator',
  'ALTER SCHEMA local_service OWNER TO bk01_migrator',
  'local_service_internal.migration_baseline',
  'local_service_internal.schema_migrations',
  'local_service_internal.request_user_id',
]) {
  if (!bootstrap.includes(needle)) fail(`Bootstrap missing required boundary: ${needle}`);
}

// ---------------------------------------------------------------------------
// Lane B criterion (b) — no product LOGIN, no schema-auth dependency
// ---------------------------------------------------------------------------
if (/create\s+role\s+bk01_migrator_login/i.test(bootstrap)) {
  fail('Bootstrap still creates the retired product LOGIN role bk01_migrator_login.');
}
if (/bk01_migrator_login/.test(bootstrap)
    && !/RAISE\s+EXCEPTION\s+'Retired role bk01_migrator_login is present/.test(bootstrap)) {
  fail('The retired product LOGIN may only be referenced by the bootstrap refusal guard.');
}
if (/\bcreate\s+role\s+\S+\s+[^;]*\blogin\b/i.test(bootstrap)) {
  fail('Bootstrap creates a LOGIN role; H2 forbids a direct product DB LOGIN in a shared project.');
}
if (!/^\s*GRANT bk01_migrator TO postgres;/m.test(bootstrap)) {
  fail('Bootstrap must let the platform operator SET ROLE bk01_migrator.');
}

// The rewritten functions must not reach into schema auth. Scan exactly the rewritten
// definitions rather than the whole file: the bootstrap legitimately *names* schema auth
// in its exception detector (ILIKE '%auth.users%') and in its guard messages, and those
// are not dependencies.
const rewrittenBlocks = [...bootstrap.matchAll(
  /-- Rewritten from the frozen chain:[^\n]*\n([\s\S]*?)\n\$bk01[_0-9]*\$;/g,
)].map((m) => m[1]);
if (rewrittenBlocks.length === 0) {
  fail('No rewritten function definitions found in the generated bootstrap.');
}
for (const rawBlock of rewrittenBlocks) {
  // strip the provenance comments: they legitimately name what was replaced
  const block = rawBlock.replace(/--[^\n]*/g, '');
  if (/(^|[^a-zA-Z0-9_])auth\s*\.\s*(uid|users|identities|sessions|refresh_tokens)/i.test(block)) {
    fail(`A rewritten function body still resolves schema auth:\n${rawBlock.slice(0, 200)}`);
  }
  if (!/set\s+search_path\s*=/i.test(block)) {
    fail(`A rewritten function lost its search_path pin:\n${rawBlock.slice(0, 200)}`);
  }
}
const helperMatch = bootstrap.match(
  /CREATE OR REPLACE FUNCTION local_service_internal\.request_user_id\(\)[\s\S]*?\$bk01_helper\$/,
);
if (!helperMatch) fail('The JWT identity helper is missing from the generated bootstrap.');
if (/\bauth\s*\./i.test(helperMatch[0])) fail('The JWT identity helper references schema auth.');

// No grant may be taken on a managed schema. Comments are stripped first: the bootstrap
// documents in prose that it takes no such grant, and that prose must not trip the check.
const bootstrapCode = bootstrap.replace(/--[^\n]*/g, '');
if (/GRANT\s+[^;]*?\bON\s+SCHEMA\s+(auth|extensions|storage|cron|net)[\s,;]/i.test(bootstrapCode)) {
  fail('Bootstrap grants on a managed schema; the fix must not depend on schema auth.');
}

// ---------------------------------------------------------------------------
// The helper contract must stay consistent with the generated bootstrap
// ---------------------------------------------------------------------------
if (contract.helper !== 'local_service_internal.request_user_id()') {
  fail(`Helper contract names an unexpected helper: ${contract.helper}`);
}
if (contract.granted_to.length !== 1 || contract.granted_to[0] !== 'bk01_migrator') {
  fail('Helper contract must grant only to bk01_migrator (no privilege expansion).');
}
for (const role of ['anon', 'authenticated', 'service_role']) {
  if (!contract.revoked_from.includes(role)) {
    fail(`Helper contract must revoke from ${role}.`);
  }
}
const declaredAuthUid = contract.rewritten_identities ?? [];
if (declaredAuthUid.length === 0) fail('Helper contract must list the rewritten identities.');
for (const identity of declaredAuthUid) {
  if (!bootstrap.includes(`local_service.${identity.slice('local_service.'.length).replace(/\(.*$/, '')}(`)) {
    fail(`Declared rewritten identity is missing from the generated bootstrap: ${identity}`);
  }
}
for (const identity of contract.ownership_exception_identities ?? []) {
  if (!bootstrap.includes(identity)) {
    fail(`Declared ownership exception is missing from the generated bootstrap: ${identity}`);
  }
}

// ---------------------------------------------------------------------------
// Rollback contract
// ---------------------------------------------------------------------------
if (/\bcreate\s+role\s+\S+\s+[^;]*\blogin\b/i.test(rollback)) {
  fail('Rollback must never create a LOGIN role.');
}
if (!/DROP ROLE( IF EXISTS)? bk01_migrator_login/i.test(rollback)) {
  fail('Rollback must retire the legacy product LOGIN where it still exists.');
}
if (!/DROP ROLE IF EXISTS bk01_migrator/i.test(rollback)) {
  fail('Rollback must drop the BK01 migrator role.');
}
if (/DROP ROLE[^;]*\bbk01_runtime\b/i.test(rollback)) {
  fail('Rollback must not drop bk01_runtime; that identity belongs to the runtime lane.');
}
for (const sql of [bootstrap, rollback]) {
  if (/\bPASSWORD\b/i.test(sql.replace(/--[^\n]*/g, ''))) {
    fail('Generated SQL must never contain a credential.');
  }
}
if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|FUNCTION|TYPE)\s+ps01\./i.test(bootstrap)) {
  fail('Generated bootstrap attempts PS01 object mutation.');
}

// ---------------------------------------------------------------------------
// Migration runner: operator session + SET ROLE, no product credential
// ---------------------------------------------------------------------------
const runner = read('scripts/bk01-migrate.mjs');
for (const needle of [
  'BK01_PLATFORM_DATABASE_URL',
  'BK01_EXPECTED_PROJECT_REF',
  'SET LOCAL ROLE bk01_migrator',
  'pg_advisory_xact_lock',
  'local_service_internal.schema_migrations',
]) {
  if (!runner.includes(needle)) fail(`Runner missing required control: ${needle}`);
}
if (/bk01_migrator_login/.test(runner)) {
  fail('Runner still authenticates as the retired product LOGIN bk01_migrator_login.');
}
if (/BK01_MIGRATOR_DATABASE_URL/.test(runner)) {
  fail('Runner still reads a product migrator credential; it must use the operator session.');
}
if (/supabase\s+(?:db\s+push|migration\s+repair|config\s+push)/i.test(runner)) {
  fail('BK01 product runner contains a forbidden shared-project Supabase CLI mutation path.');
}

// ---------------------------------------------------------------------------
// Package + config contracts
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Frozen stream must be untouched
// ---------------------------------------------------------------------------
const migrationDiff = execFileSync('git', ['diff', '--name-only', '--', 'supabase/migrations'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (migrationDiff) fail(`Frozen legacy migrations were modified:\n${migrationDiff}`);

console.log('BK01 shared-runtime repository verification PASS');
console.log(`Frozen legacy migrations: ${legacyFiles.length}`);
console.log(`Legacy source SHA-256: ${legacyHash}`);
console.log(`Rewritten auth.uid() functions: ${declaredAuthUid.length}`);
console.log(`Ownership exceptions (declared = measured): ${(contract.ownership_exception_identities ?? []).length}`);
console.log('Product DB LOGIN in bootstrap/runner/rollback: none');
console.log('Schema-auth dependency in generated bodies: none');
console.log('Active migration stream: supabase/bk01-migrations');
console.log('Platform/global Supabase CLI mutation path: disabled by contract');
