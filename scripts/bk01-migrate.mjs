import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { validateBk01MigrationSql } from './lib/bk01-migration-policy.mjs';

const RUNNER_VERSION = '1.0.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'supabase', 'bk01-migrations');
const baselinePath = path.join(root, 'supabase', 'shared-runtime', 'bk01-legacy-baseline.json');
const mode = process.argv[2];

const log = (level, event, detail = {}) => {
  process.stdout.write(`${JSON.stringify({ level, event, ...detail })}\n`);
};

function fail(message) {
  throw new Error(message);
}

if (!['plan', 'apply'].includes(mode)) {
  fail('Usage: node scripts/bk01-migrate.mjs <plan|apply>');
}

const databaseUrl = process.env.BK01_MIGRATOR_DATABASE_URL?.trim();
if (!databaseUrl) fail('BK01_MIGRATOR_DATABASE_URL is required.');
const environment = process.env.BK01_SHARED_RUNTIME_ENV?.trim().toLowerCase();
if (!environment) fail('BK01_SHARED_RUNTIME_ENV is required.');

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  fail('BK01_MIGRATOR_DATABASE_URL must be a valid PostgreSQL connection URL.');
}
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
  fail('BK01_MIGRATOR_DATABASE_URL must use postgresql:// or postgres://.');
}
const sessionLogin = decodeURIComponent(parsedUrl.username).split('.')[0];
if (sessionLogin !== 'bk01_migrator_login') {
  fail(`Migration URL must authenticate as bk01_migrator_login, got ${sessionLogin || '<empty>'}.`);
}

const expectedProjectRef = process.env.BK01_EXPECTED_PROJECT_REF?.trim();
if (environment !== 'local') {
  if (!expectedProjectRef) fail('BK01_EXPECTED_PROJECT_REF is required outside local development.');
  const identityText = `${parsedUrl.hostname} ${decodeURIComponent(parsedUrl.username)}`;
  if (!identityText.includes(expectedProjectRef)) {
    fail('Database URL does not match BK01_EXPECTED_PROJECT_REF.');
  }
}

const releaseId = process.env.BK01_RELEASE_ID?.trim();
if (mode === 'apply' && !releaseId) {
  fail('BK01_RELEASE_ID is required for apply.');
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const migrationFiles = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const filename of migrationFiles) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(filename)) {
    fail(`Invalid BK01 migration filename: ${filename}`);
  }
}

const migrations = migrationFiles.map((filename) => {
  const raw = fs.readFileSync(path.join(migrationDir, filename), 'utf8');
  const sqlText = raw.replace(/\r\n/g, '\n');
  validateBk01MigrationSql(sqlText, filename);
  return {
    filename,
    migrationId: filename.slice(0, -4),
    sqlText,
    sourceSha256: crypto.createHash('sha256').update(sqlText).digest('hex'),
  };
});

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => {},
});

async function verifyBoundary(tx) {
  const rows = await tx.unsafe(`
    select
      current_user,
      session_user,
      pg_get_userbyid((select nspowner from pg_namespace where nspname='local_service')) as product_owner,
      pg_get_userbyid((select nspowner from pg_namespace where nspname='local_service_internal')) as internal_owner,
      has_database_privilege(current_user, current_database(), 'CREATE') as db_create,
      has_schema_privilege(current_user, 'public', 'CREATE') as public_create,
      case when to_regnamespace('ps01') is null then false else has_schema_privilege(current_user, 'ps01', 'USAGE') end as ps01_usage,
      case when to_regnamespace('ps01_internal') is null then false else has_schema_privilege(current_user, 'ps01_internal', 'USAGE') end as ps01_internal_usage,
      case when to_regnamespace('storage') is null then false else has_schema_privilege(current_user, 'storage', 'USAGE') end as storage_usage
  `);
  const state = rows[0];
  if (!state || state.current_user !== 'bk01_migrator') {
    fail(`Expected current_user=bk01_migrator after SET ROLE, got ${state?.current_user ?? '<none>'}.`);
  }
  if (state.session_user !== 'bk01_migrator_login') {
    fail(`Expected session_user=bk01_migrator_login, got ${state.session_user}.`);
  }
  if (state.product_owner !== 'bk01_migrator' || state.internal_owner !== 'bk01_migrator') {
    fail('BK01 schema ownership boundary is not established.');
  }
  if (state.db_create || state.public_create || state.ps01_usage || state.ps01_internal_usage || state.storage_usage) {
    fail('BK01 migrator has authority outside the approved product boundary.');
  }

  const baselineRows = await tx.unsafe(`
    select source_sha256, migration_count, last_legacy_version
    from local_service_internal.migration_baseline
    where baseline_id = 'legacy-global-history'
  `);
  const liveBaseline = baselineRows[0];
  if (!liveBaseline) fail('BK01 migration baseline is missing. Run the platform bootstrap first.');
  if (liveBaseline.source_sha256 !== baseline.sourceSha256
      || Number(liveBaseline.migration_count) !== baseline.frozenMigrationCount
      || liveBaseline.last_legacy_version !== baseline.lastLegacyVersion) {
    fail('BK01 live legacy baseline does not match the repository manifest.');
  }
}

async function run() {
  log('info', 'bk01.migration.start', { mode, environment, runnerVersion: RUNNER_VERSION });
  await sql.begin(async (tx) => {
    if (mode === 'plan') await tx.unsafe('SET TRANSACTION READ ONLY');
    await tx.unsafe('SET LOCAL ROLE bk01_migrator');
    await verifyBoundary(tx);
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('bk01:shared-runtime:migrations', 0))");

    const appliedRows = await tx.unsafe(`
      select migration_id, filename, source_sha256
      from local_service_internal.schema_migrations
      order by migration_id
    `);
    const applied = new Map(appliedRows.map((row) => [row.migration_id, row]));
    const pending = [];

    for (const migration of migrations) {
      const prior = applied.get(migration.migrationId);
      if (prior) {
        if (prior.filename !== migration.filename || prior.source_sha256 !== migration.sourceSha256) {
          fail(`Applied migration checksum mismatch: ${migration.migrationId}`);
        }
        continue;
      }
      pending.push(migration);
    }

    const localIds = new Set(migrations.map((migration) => migration.migrationId));
    const orphaned = appliedRows.filter((row) => !localIds.has(row.migration_id));
    if (orphaned.length > 0) {
      fail(`Repository is missing applied BK01 migration(s): ${orphaned.map((row) => row.migration_id).join(', ')}`);
    }

    log('info', 'bk01.migration.plan', {
      appliedCount: appliedRows.length,
      pendingCount: pending.length,
      pending: pending.map((migration) => migration.filename),
    });

    if (mode === 'plan') return;

    for (const migration of pending) {
      log('info', 'bk01.migration.apply', { migration: migration.filename });
      await tx.unsafe(migration.sqlText);
      await tx.unsafe(
        `insert into local_service_internal.schema_migrations
          (migration_id, filename, source_sha256, release_id, runner_version)
         values ($1, $2, $3, $4, $5)`,
        [migration.migrationId, migration.filename, migration.sourceSha256, releaseId, RUNNER_VERSION],
      );
    }

    log('info', 'bk01.migration.complete', { appliedNow: pending.length, releaseId });
  });
}

try {
  await run();
} catch (error) {
  log('error', 'bk01.migration.failed', {
    mode,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
