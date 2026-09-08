import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyDir = path.join(root, 'supabase', 'migrations');
const outputDir = path.join(root, 'supabase', 'shared-runtime');
const bootstrapPath = path.join(outputDir, 'bk01-platform-bootstrap.sql');
const manifestPath = path.join(outputDir, 'bk01-legacy-baseline.json');
const expectedLegacyCount = 30;

const files = fs.readdirSync(legacyDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length !== expectedLegacyCount) {
  throw new Error(`Legacy BK01 migration stream is frozen at ${expectedLegacyCount} files; found ${files.length}. Add new shared-runtime migrations under supabase/bk01-migrations.`);
}

const sources = files.map((name) => ({
  name,
  text: fs.readFileSync(path.join(legacyDir, name), 'utf8').replace(/\r\n/g, '\n'),
}));
const sourceHash = crypto.createHash('sha256')
  .update(sources.map(({ name, text }) => `${name}\n${text}`).join('\n'))
  .digest('hex');
const lastLegacyVersion = files.at(-1).match(/^(\d{14})_/)?.[1];
if (!lastLegacyVersion) throw new Error('Unable to resolve the final legacy migration version.');

const bootstrap = String.raw`-- GENERATED FILE. DO NOT EDIT DIRECTLY.
-- Platform-admin bootstrap for BK01 shared-runtime migration isolation.
-- Legacy source SHA-256: ${sourceHash}
-- Legacy migration count: ${files.length}
DO $bk01_roles$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 platform bootstrap requires postgres, got %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator') THEN
    CREATE ROLE bk01_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator_login') THEN
    CREATE ROLE bk01_migrator_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_migrator'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Existing bk01_migrator has unsafe attributes'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_migrator_login'
      AND (NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Existing bk01_migrator_login has unsafe attributes'; END IF;
END
$bk01_roles$;
`;

const bootstrapSql = bootstrap + String.raw`
GRANT bk01_migrator TO postgres;
GRANT bk01_migrator TO bk01_migrator_login;
ALTER ROLE bk01_migrator_login SET search_path = 'local_service', 'local_service_internal', 'pg_catalog';
ALTER ROLE bk01_migrator_login SET statement_timeout = '15s';
ALTER ROLE bk01_migrator_login SET lock_timeout = '8s';

CREATE SCHEMA IF NOT EXISTS local_service_internal AUTHORIZATION bk01_migrator;
ALTER SCHEMA local_service OWNER TO bk01_migrator;
ALTER SCHEMA local_service_internal OWNER TO bk01_migrator;
REVOKE ALL ON SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA local_service TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth, extensions TO bk01_migrator;

DO $bk01_db_privileges$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM bk01_migrator', current_database());
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM bk01_migrator_login', current_database());
END
$bk01_db_privileges$;

DO $bk01_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'local_service' AND c.relkind IN ('r','p','v','m','S','c')
    ORDER BY c.relkind, c.relname
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of local_service.% from unexpected owner %', r.relname, r.owner_name;
    END IF;
    IF r.owner_name = 'postgres' THEN
      CASE r.relkind
        WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO bk01_migrator', r.relname);
        ELSE RAISE EXCEPTION 'Unsupported local_service relation kind %', r.relkind;
      END CASE;
    END IF;
  END LOOP;
END
$bk01_rel_owners$;

DO $bk01_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS signature,
      pg_get_userbyid(p.proowner) AS owner_name,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service' AND p.prokind = 'f'
    ORDER BY p.oid::regprocedure::text
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of % from unexpected owner %', r.signature, r.owner_name;
    END IF;
    IF r.definition ILIKE '%auth.users%' OR r.definition ILIKE '%storage.%' THEN
      IF r.signature NOT IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)'
      ) THEN
        RAISE EXCEPTION 'Unregistered shared-surface function dependency: %', r.signature;
      END IF;
      CONTINUE;
    END IF;
    IF r.owner_name = 'postgres' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO bk01_migrator', r.signature);
    END IF;
  END LOOP;
END
$bk01_function_owners$;

CREATE TABLE IF NOT EXISTS local_service_internal.migration_baseline (
  baseline_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  migration_count integer NOT NULL CHECK (migration_count > 0),
  last_legacy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service_internal.migration_baseline OWNER TO bk01_migrator;
`;

const ledgerSql = String.raw`
CREATE TABLE IF NOT EXISTS local_service_internal.schema_migrations (
  migration_id text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  release_id text NOT NULL,
  runner_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service_internal.schema_migrations OWNER TO bk01_migrator;
REVOKE ALL ON ALL TABLES IN SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO local_service_internal.migration_baseline (
  baseline_id, source_sha256, migration_count, last_legacy_version
) VALUES (
  'legacy-global-history', '${sourceHash}', ${files.length}, '${lastLegacyVersion}'
) ON CONFLICT (baseline_id) DO NOTHING;

DO $bk01_baseline_check$
DECLARE baseline record;
BEGIN
  SELECT * INTO baseline
  FROM local_service_internal.migration_baseline
  WHERE baseline_id = 'legacy-global-history';
  IF baseline.source_sha256 <> '${sourceHash}'
     OR baseline.migration_count <> ${files.length}
     OR baseline.last_legacy_version <> '${lastLegacyVersion}' THEN
    RAISE EXCEPTION 'BK01 legacy baseline mismatch; refusing shared-runtime bootstrap';
  END IF;
END
$bk01_baseline_check$;
`;

const verificationSql = String.raw`
DO $bk01_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  IF pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='local_service')) <> 'bk01_migrator'
     OR pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='local_service_internal')) <> 'bk01_migrator' THEN
    RAISE EXCEPTION 'BK01 schema ownership boundary is not established';
  END IF;
  IF has_database_privilege('bk01_migrator', current_database(), 'CREATE')
     OR has_database_privilege('bk01_migrator_login', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration roles have database-wide CREATE';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'ps01', 'USAGE')
     OR has_schema_privilege('bk01_migrator', 'ps01_internal', 'USAGE')
     OR has_schema_privilege('bk01_migrator_login', 'ps01', 'USAGE') THEN
    RAISE EXCEPTION 'BK01 migration role crosses PS01 schema boundary';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration role can create in public';
  END IF;

  SELECT count(*) INTO unexpected_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
    AND pg_get_userbyid(c.relowner) <> 'bk01_migrator';
  IF unexpected_count <> 0 THEN RAISE EXCEPTION 'BK01 relation ownership transfer incomplete: %', unexpected_count; END IF;
END
$bk01_boundary_check$;
`;

const functionVerificationSql = String.raw`
DO $bk01_function_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  SELECT count(*) INTO unexpected_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND p.prokind='f'
    AND (
      (p.oid::regprocedure::text IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)'
      ) AND pg_get_userbyid(p.proowner) <> 'postgres')
      OR
      (p.oid::regprocedure::text NOT IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)'
      ) AND pg_get_userbyid(p.proowner) <> 'bk01_migrator')
    );
  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'BK01 function ownership boundary mismatch: %', unexpected_count;
  END IF;
END
$bk01_function_boundary_check$;
`;

const output = `${bootstrapSql}${ledgerSql}${verificationSql}${functionVerificationSql}`;
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(bootstrapPath, output, 'utf8');
fs.writeFileSync(manifestPath, `${JSON.stringify({
  version: 1,
  source: 'supabase/migrations',
  frozenMigrationCount: files.length,
  sourceSha256: sourceHash,
  lastLegacyVersion,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');
console.log(`Generated ${path.relative(root, bootstrapPath)}`);
console.log(`Generated ${path.relative(root, manifestPath)}`);
console.log(`Legacy source SHA-256: ${sourceHash}`);
